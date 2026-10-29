"use client";

import type { StateCreator } from "zustand";
import type { Document, FocusedPane } from "../../types";
import { applyDocMeta, getDocMeta } from "../../docMeta";
import {
  docLinkNames,
  extractWikiLinks,
  pathTargetOf,
  rewriteWikiLinksWithMap,
  type WikiRewriteMapping,
} from "../../wikilink";
import { resolveWikiTarget } from "../../search";
import { isImportableLibraryPath, libraryDocTypeFromPath, normalizeImportedPath } from "../../importable";
import { basename, dirname, normalizeNewlines, titleOf, uid } from "../../utils";
import { pushVersion } from "../../storage/versions";
import { ensureLibraryDir } from "../../storage/fsSync";
import { ensureContentFolder } from "../../storage/contentApi";
import {
  folderExists,
  isSelfOrDescendantFolder,
  joinFolderPath,
  normalizeFolderPath,
  parseFolderInput,
  pruneEmptyFolders,
  remapEmptyFolders,
  sanitizeFolderSegment,
} from "../../folders";
import { BUILTIN_TEMPLATES, applyTemplate, dailyNoteSpec } from "../../templates";
import { ensureUniquePath } from "../helpers/paths";
import { softNavigate } from "../helpers/navigation";
import { scheduleContentPersist } from "../helpers/persistSchedule";
import type { LanghuanState } from "../types";

type DocsSliceKeys =
  | "documents"
  | "drafts"
  | "emptyFolders"
  | "activeId"
  | "pendingNav"
  | "openHome"
  | "openDoc"
  | "requestOpenDoc"
  | "requestOpenHome"
  | "resolvePendingNav"
  | "getActive"
  | "getContent"
  | "isDirty"
  | "anyDirty"
  | "setDraft"
  | "saveDoc"
  | "discardDraft"
  | "createDoc"
  | "createFolder"
  | "importFiles"
  | "renameDoc"
  | "renameFolder"
  | "moveFolder"
  | "openDailyNote"
  | "createFromTemplate";

export type DocsSlice = Pick<LanghuanState, DocsSliceKeys>;

function countUnresolvedWikiLinks(docs: Document[]): number {
  let n = 0;
  for (const d of docs) {
    for (const r of extractWikiLinks(d.content)) {
      if (!r.target) continue;
      if (!resolveWikiTarget(docs, r.target)) n += 1;
    }
  }
  return n;
}

type RenameSessionEntry = {
  id: string;
  oldPath: string;
  newPath: string;
  oldNames: string[];
  oldTitle: string;
  newTitle: string;
  newPathTarget: string;
  type: Document["type"];
};

/**
 * One rename session: update paths + aliases for entries, then a single
 * library-wide rewriteWikiLinksWithMap pass (each body rewritten once).
 */
function applyWikiRenameSession(
  get: () => LanghuanState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  entries: RenameSessionEntry[],
  statusWhenNoLinks: string
): { linkUpdates: number; unresolved: number } {
  if (!entries.length) {
    get().setStatus(statusWhenNoLinks);
    return { linkUpdates: 0, unresolved: countUnresolvedWikiLinks(get().documents) };
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const renamedIds = new Set(entries.map((e) => e.id));
  const mappings: WikiRewriteMapping[] = entries.map((e) => ({
    oldNames: e.oldNames,
    newTarget: e.newTitle,
    newPathTarget: e.newPathTarget,
    styleHint: "title" as const,
  }));

  let linkUpdates = 0;
  const changedIds = new Set<string>();
  const now = Date.now();
  const prevPaths = new Map(entries.map((e) => [e.id, e.oldPath]));
  const originalById = new Map(get().documents.map((d) => [d.id, d]));

  const documents = get().documents.map((d) => {
    const entry = byId.get(d.id);
    if (entry) {
      let content = d.content;
      if (entry.oldTitle && entry.oldTitle !== entry.newTitle) {
        const prevAliases = getDocMeta(d).aliases;
        const nextAliases = [
          entry.oldTitle,
          ...prevAliases.filter((a) => a !== entry.oldTitle && a !== entry.newTitle),
        ].slice(0, 10);
        if (nextAliases.join("\0") !== prevAliases.join("\0")) {
          void pushVersion({ docId: d.id, content: d.content, path: d.path });
          content = applyDocMeta(content, entry.type, { aliases: nextAliases });
          changedIds.add(d.id);
        }
      }
      return {
        ...d,
        path: entry.newPath,
        type: entry.type,
        content,
        updatedAt: now,
      };
    }

    const { content, count } = rewriteWikiLinksWithMap(d.content, mappings);
    if (!count) return d;
    void pushVersion({ docId: d.id, content: d.content, path: d.path });
    linkUpdates += count;
    changedIds.add(d.id);
    return { ...d, content, updatedAt: now };
  });

  // Sibling links inside renamed docs themselves
  const documents2 = documents.map((d) => {
    if (!renamedIds.has(d.id)) return d;
    const { content, count } = rewriteWikiLinksWithMap(d.content, mappings);
    if (!count) return d;
    if (!changedIds.has(d.id)) {
      const prev = originalById.get(d.id);
      if (prev) void pushVersion({ docId: d.id, content: prev.content, path: prev.path });
    }
    linkUpdates += count;
    changedIds.add(d.id);
    return { ...d, content, updatedAt: now };
  });

  const drafts = { ...get().drafts };
  for (const [did, draftContent] of Object.entries(drafts)) {
    const { content, count } = rewriteWikiLinksWithMap(draftContent, mappings);
    if (count) {
      drafts[did] = content;
      linkUpdates += count;
    }
  }

  set((s: LanghuanState) => ({
    documents: documents2,
    drafts,
    emptyFolders: pruneEmptyFolders(
      s.emptyFolders,
      documents2.map((d) => d.path)
    ),
  }));

  const unresolved = countUnresolvedWikiLinks(get().documents);
  if (linkUpdates > 0) {
    get().setStatus(`已重命名，并更新 ${linkUpdates} 处双链；另有 ${unresolved} 处仍无法解析`);
  } else {
    get().setStatus(statusWhenNoLinks);
  }

  for (const e of entries) {
    const doc = get().documents.find((d) => d.id === e.id);
    scheduleContentPersist(
      get,
      set,
      doc,
      prevPaths.get(e.id) !== e.newPath ? prevPaths.get(e.id) : undefined
    );
  }
  for (const d of get().documents) {
    if (!renamedIds.has(d.id) && changedIds.has(d.id)) {
      scheduleContentPersist(get, set, d);
    }
  }

  return { linkUpdates, unresolved };
}

function buildRenameEntry(
  prev: Document,
  newPathRaw: string,
  allDocs: Document[]
): RenameSessionEntry {
  const path = ensureUniquePath(newPathRaw.replace(/\\/g, "/"), allDocs, prev.id);
  const ext = path.toLowerCase().endsWith(".html")
    ? "html"
    : path.toLowerCase().endsWith(".md")
      ? "md"
      : null;
  return {
    id: prev.id,
    oldPath: prev.path,
    newPath: path,
    oldNames: docLinkNames(prev, getDocMeta(prev).aliases),
    oldTitle: titleOf(prev.path),
    newTitle: titleOf(path),
    newPathTarget: pathTargetOf(path),
    type: (ext as Document["type"]) || prev.type,
  };
}

export const createDocsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  DocsSlice
> = (set, get) => ({
  documents: [],
  drafts: {},
  emptyFolders: [],
  activeId: null,
  pendingNav: null,
  openHome: () =>
        set({
          activeId: null,
          htmlImmersive: false,
          htmlSidebarPeek: false,
          htmlScrollPercent: 0,
          editorCaret: null,
          focusedPane: "primary",
        }),
  openDoc: (id) => {
        set((s) => {
          const tabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id];
          return {
            activeId: id,
            openTabs: tabs,
            sidebarOpen: false,
            htmlImmersive: false,
            htmlSidebarPeek: false,
            htmlScrollPercent: 0,
            editorCaret: null,
            focusedPane: "primary" as FocusedPane,
          };
        });
      },
  requestOpenDoc: (id) => softNavigate(get, set, { kind: "doc", id }),
  requestOpenHome: () => softNavigate(get, set, { kind: "home" }),
  resolvePendingNav: (action) => {
        const pending = get().pendingNav;
        if (!pending) return;
        if (action === "cancel") {
          set({ pendingNav: null });
          return;
        }
        const cur = get().activeId;
        if (cur) {
          if (action === "save") get().saveDoc(cur);
          else get().discardDraft(cur);
        }
        set({ pendingNav: null });
        if (pending.kind === "home") get().openHome();
        else get().openDoc(pending.id);
      },
  getActive: () => {
        const { activeId, documents } = get();
        return documents.find((d) => d.id === activeId) || null;
      },
  getContent: (id) => {
        const { drafts, documents } = get();
        const raw = id in drafts ? drafts[id] : documents.find((d) => d.id === id)?.content ?? "";
        return normalizeNewlines(raw);
      },
  isDirty: (id) => {
        const { drafts, documents } = get();
        if (!(id in drafts)) return false;
        const doc = documents.find((d) => d.id === id);
        return !!doc && drafts[id] !== doc.content;
      },
  anyDirty: () => {
        const { drafts, documents } = get();
        return documents.some((d) => d.id in drafts && drafts[d.id] !== d.content);
      },
  setDraft: (id, content) =>
        set((s) => ({ drafts: { ...s.drafts, [id]: content } })),
  saveDoc: (id) => {
        const target = id || get().activeId;
        if (!target) return;
        const content = get().getContent(target);
        const prev = get().documents.find((d) => d.id === target);
        // Snapshot previous saved content before overwrite
        if (prev) {
          void pushVersion({
            docId: prev.id,
            content: prev.content,
            path: prev.path,
          });
        }
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === target ? { ...d, content, updatedAt: Date.now() } : d
          ),
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== target)),
        }));
        const doc = get().documents.find((d) => d.id === target);
        get().setStatus(`已保存 ${doc ? basename(doc.path) : ""}`);
        void get().refreshStorageUsage();
        scheduleContentPersist(get, set, doc);
      },
  discardDraft: (id) => {
        const target = id || get().activeId;
        if (!target) return;
        set((s) => ({
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== target)),
        }));
        get().setStatus("已放弃未保存修改");
      },
  createDoc: ({ type, path, content, open = true }) => {
        const ext = type === "md" ? ".md" : ".html";
        const defaultPath = type === "md" ? `未命名笔记${ext}` : `未命名页面${ext}`;
        const p = ensureUniquePath(path || defaultPath, get().documents);
        const defaultContent =
          content ??
          (type === "md"
            ? `---\ntitle: ${basename(p).replace(/\.md$/i, "")}\ntags: []\n---\n\n# ${basename(p).replace(/\.md$/i, "")}\n\n`
            : `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="keywords" content="" />\n  <title>${basename(p).replace(/\.html$/i, "")}</title>\n</head>\n<body>\n  <h1>${basename(p).replace(/\.html$/i, "")}</h1>\n</body>\n</html>\n`);
        const doc: Document = {
          id: uid(),
          path: p,
          type,
          content: defaultContent,
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => {
          const openTabs =
            open && !s.openTabs.includes(doc.id)
              ? [...s.openTabs, doc.id]
              : s.openTabs;
          const documents = [...s.documents, doc];
          return {
            documents,
            emptyFolders: pruneEmptyFolders(
              s.emptyFolders,
              documents.map((d) => d.path)
            ),
            activeId: open ? doc.id : s.activeId,
            openTabs,
            viewMode: open ? "source" : s.viewMode,
          };
        });
        get().setStatus(`已新建 ${basename(doc.path)}`);
        void get().refreshStorageUsage();
        scheduleContentPersist(get, set, doc);
        return doc;
      },
  createFolder: (name, parentPath = "") => {
        const parsed = parseFolderInput(name, parentPath);
        if (!parsed.ok) {
          get().setStatus(parsed.reason);
          return null;
        }
        const full = parsed.fullPath;
        const docs = get().documents;
        const docPaths = docs.map((d) => d.path.replace(/\\/g, "/"));
        const existingEmpty = new Set(
          get().emptyFolders.map((f) => normalizeFolderPath(f)).filter(Boolean)
        );
        const layerExists = (layer: string) => {
          const prefix = layer + "/";
          if (existingEmpty.has(layer)) return true;
          return docPaths.some((d) => d.startsWith(prefix));
        };
        const parts = full.split("/").filter(Boolean);
        const toAdd: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          const layer = parts.slice(0, i + 1).join("/");
          if (!layerExists(layer)) toAdd.push(layer);
        }
        if (toAdd.length === 0) {
          get().setStatus(`文件夹已存在 ${full}`);
          return full;
        }
        set((s) => ({
          emptyFolders: pruneEmptyFolders(
            [...s.emptyFolders, ...toAdd],
            s.documents.map((d) => d.path)
          ),
          sidebarPanel: "docs",
        }));
        get().setStatus(`已新建文件夹 ${full}`);
        for (let i = 0; i < parts.length; i++) {
          const layer = parts.slice(0, i + 1).join("/");
          void ensureContentFolder(layer).catch(() => {
            /* best-effort */
          });
          if (get().fsBoundName) {
            void ensureLibraryDir(layer).catch(() => {
              /* best-effort */
            });
          }
        }
        return full;
      },
  importFiles: (files, opts) => {
        let n = 0;
        const docs = [...get().documents];
        const created: Document[] = [];
        for (const f of files) {
          if (!isImportableLibraryPath(f.path)) continue;
          const type = libraryDocTypeFromPath(f.path);
          let path = normalizeImportedPath(f.path);
          path = ensureUniquePath(path, docs);
          const doc: Document = {
            id: uid(),
            path,
            type,
            content: f.content,
            starred: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          docs.push(doc);
          created.push(doc);
          n += 1;
        }
        set((s) => ({
          documents: docs,
          emptyFolders: pruneEmptyFolders(
            s.emptyFolders,
            docs.map((d) => d.path)
          ),
        }));
        for (const doc of created) scheduleContentPersist(get, set, doc);
        if (n && !opts?.quiet) get().setStatus(`已导入 ${n} 篇文档`);
        void get().refreshStorageUsage();
        return n;
      },
  renameDoc: (id, newPath) => {
        const prev = get().documents.find((d) => d.id === id);
        if (!prev) return;
        const entry = buildRenameEntry(prev, newPath, get().documents);
        applyWikiRenameSession(get, set, [entry], `已重命名为 ${basename(entry.newPath)}`);
      },

  renameFolder: (oldPath, newSegment) => {
        const old = normalizeFolderPath(oldPath);
        if (!old) {
          get().setStatus("不能重命名库根目录");
          return null;
        }
        const segment = sanitizeFolderSegment(newSegment);
        if (!segment) {
          get().setStatus("文件夹名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）");
          return null;
        }
        const parent = dirname(old);
        const neu = joinFolderPath(parent, segment);
        if (!neu) {
          get().setStatus("文件夹名无效");
          return null;
        }
        if (neu === old) return old;
        const docPaths = get().documents.map((d) => d.path);
        if (folderExists(neu, docPaths, get().emptyFolders)) {
          get().setStatus(`目标已存在 ${neu}`);
          return null;
        }
        const prefix = old + "/";
        const under = get().documents.filter((d) =>
          d.path.replace(/\\/g, "/").startsWith(prefix)
        );
        // Collect all old→new mappings, then one library rewrite pass.
        let planned = get().documents.slice();
        const entries: RenameSessionEntry[] = [];
        for (const d of under) {
          const rel = d.path.replace(/\\/g, "/").slice(old.length);
          const entry = buildRenameEntry(d, neu + rel, planned);
          entries.push(entry);
          planned = planned.map((x) =>
            x.id === entry.id ? { ...x, path: entry.newPath, type: entry.type } : x
          );
        }
        applyWikiRenameSession(get, set, entries, `已重命名文件夹为 ${neu}`);
        set((s) => ({
          emptyFolders: pruneEmptyFolders(
            remapEmptyFolders(s.emptyFolders, old, neu),
            get().documents.map((d) => d.path)
          ),
          sidebarPanel: "docs",
        }));
        const st = get().status?.message || "";
        if (!st.includes("双链")) {
          get().setStatus(`已重命名文件夹为 ${neu}`);
        } else {
          get().setStatus(st.replace(/^已重命名，/, `已重命名文件夹为 ${neu}，`));
        }
        if (get().fsBoundName) {
          void ensureLibraryDir(neu).catch(() => {});
        }
        void ensureContentFolder(neu).catch(() => {});
        return neu;
      },
  moveFolder: (oldPath, newParentPath) => {
        const old = normalizeFolderPath(oldPath);
        if (!old) {
          get().setStatus("不能移动库根目录");
          return null;
        }
        const newParent = normalizeFolderPath(newParentPath || "");
        if (isSelfOrDescendantFolder(old, newParent)) {
          get().setStatus("不能将文件夹移入自身或其子目录");
          return null;
        }
        const leaf = basename(old);
        const neu = joinFolderPath(newParent, leaf);
        if (!neu) {
          get().setStatus("目标路径无效");
          return null;
        }
        if (neu === old) return old;
        const docPaths = get().documents.map((d) => d.path);
        if (folderExists(neu, docPaths, get().emptyFolders)) {
          get().setStatus(`目标已存在 ${neu}`);
          return null;
        }
        const prefix = old + "/";
        const under = get().documents.filter((d) =>
          d.path.replace(/\\/g, "/").startsWith(prefix)
        );
        let planned = get().documents.slice();
        const entries: RenameSessionEntry[] = [];
        for (const d of under) {
          const rel = d.path.replace(/\\/g, "/").slice(old.length);
          const entry = buildRenameEntry(d, neu + rel, planned);
          entries.push(entry);
          planned = planned.map((x) =>
            x.id === entry.id ? { ...x, path: entry.newPath, type: entry.type } : x
          );
        }
        applyWikiRenameSession(get, set, entries, `已移动文件夹到 ${neu}`);
        set((s) => ({
          emptyFolders: pruneEmptyFolders(
            remapEmptyFolders(s.emptyFolders, old, neu),
            get().documents.map((d) => d.path)
          ),
          sidebarPanel: "docs",
        }));
        const st = get().status?.message || "";
        if (!st.includes("双链")) {
          get().setStatus(`已移动文件夹到 ${neu}`);
        } else {
          get().setStatus(st.replace(/^已重命名，/, `已移动文件夹到 ${neu}，`));
        }
        if (get().fsBoundName) {
          void ensureLibraryDir(neu).catch(() => {});
        }
        void ensureContentFolder(neu).catch(() => {});
        return neu;
      },
  openDailyNote: () => {
        const spec = dailyNoteSpec();
        const existing = get().documents.find((d) => d.path === spec.path);
        if (existing) {
          get().requestOpenDoc(existing.id);
          get().setStatus(`已打开今日笔记 ${spec.path}`);
          return existing;
        }
        return get().createDoc({ type: "md", path: spec.path, content: spec.content, open: true });
      },
  createFromTemplate: (templateId, title) => {
        const tpl = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
        if (!tpl) {
          get().setStatus("未找到模板");
          return null;
        }
        const spec = applyTemplate(tpl, { title: title || tpl.name });
        return get().createDoc({ type: "md", path: spec.path, content: spec.content, open: true });
      },
});
