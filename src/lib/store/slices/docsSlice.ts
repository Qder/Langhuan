"use client";

import type { StateCreator } from "zustand";
import type { Document, FocusedPane } from "../../types";
import { getDocMeta } from "../../docMeta";
import { docLinkNames, rewriteWikiLinksOnRename } from "../../wikilink";
import { isImportableLibraryPath, libraryDocTypeFromPath, normalizeImportedPath } from "../../importable";
import { basename, normalizeNewlines, titleOf, uid } from "../../utils";
import { pushVersion } from "../../storage/versions";
import { ensureLibraryDir } from "../../storage/fsSync";
import { ensureContentFolder } from "../../storage/contentApi";
import {
  joinFolderPath,
  normalizeFolderPath,
  pruneEmptyFolders,
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
  | "openDailyNote"
  | "createFromTemplate";

export type DocsSlice = Pick<LanghuanState, DocsSliceKeys>;

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
        const segment = sanitizeFolderSegment(name);
        if (!segment) {
          get().setStatus("文件夹名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）");
          return null;
        }
        const parent = normalizeFolderPath(parentPath || "");
        const full = joinFolderPath(parent, segment);
        if (!full) {
          get().setStatus("文件夹名无效");
          return null;
        }
        const docs = get().documents;
        const prefix = full + "/";
        const coveredByDoc = docs.some((d) => d.path.replace(/\\/g, "/").startsWith(prefix));
        const alreadyEmpty = get().emptyFolders.some(
          (f) => normalizeFolderPath(f) === full
        );
        if (coveredByDoc || alreadyEmpty) {
          get().setStatus(`文件夹已存在 ${full}`);
          return full;
        }
        set((s) => ({
          emptyFolders: pruneEmptyFolders(
            [...s.emptyFolders, full],
            s.documents.map((d) => d.path)
          ),
          sidebarPanel: "docs",
        }));
        get().setStatus(`已新建文件夹 ${full}`);
        void ensureContentFolder(full).catch(() => {
          /* best-effort */
        });
        if (get().fsBoundName) {
          void ensureLibraryDir(full).catch(() => {
            /* best-effort */
          });
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
        const path = ensureUniquePath(newPath.replace(/\\/g, "/"), get().documents, id);
        const ext = path.toLowerCase().endsWith(".html")
          ? "html"
          : path.toLowerCase().endsWith(".md")
            ? "md"
            : null;
        const oldNames = docLinkNames(prev, getDocMeta(prev).aliases);
        const newTitle = titleOf(path);
        let linkUpdates = 0;
        const documents = get().documents.map((d) => {
          if (d.id === id) {
            return {
              ...d,
              path,
              type: (ext as Document["type"]) || d.type,
              updatedAt: Date.now(),
            };
          }
          if (d.type !== "md") return d;
          const { content, count } = rewriteWikiLinksOnRename(d.content, oldNames, newTitle);
          if (!count) return d;
          linkUpdates += count;
          return { ...d, content, updatedAt: Date.now() };
        });
        // Also rewrite drafts that reference old names
        const drafts = { ...get().drafts };
        for (const [did, draftContent] of Object.entries(drafts)) {
          if (did === id) continue;
          const doc = documents.find((x) => x.id === did);
          if (!doc || doc.type !== "md") continue;
          const { content, count } = rewriteWikiLinksOnRename(draftContent, oldNames, newTitle);
          if (count) {
            drafts[did] = content;
            linkUpdates += count;
          }
        }
        set((s) => ({
          documents,
          drafts,
          emptyFolders: pruneEmptyFolders(
            s.emptyFolders,
            documents.map((d) => d.path)
          ),
        }));
        const msg =
          linkUpdates > 0
            ? `已重命名为 ${basename(path)}，并更新 ${linkUpdates} 处双链`
            : `已重命名为 ${basename(path)}`;
        get().setStatus(msg);
        const renamed = get().documents.find((d) => d.id === id);
        scheduleContentPersist(get, set, renamed, prev.path !== path ? prev.path : undefined);
        if (linkUpdates > 0) {
          for (const d of get().documents) {
            if (d.id !== id && d.type === "md") scheduleContentPersist(get, set, d);
          }
        }
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
