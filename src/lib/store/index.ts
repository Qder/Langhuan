"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AssetMeta,
  Document,
  FocusedPane,
  TrashItem,
} from "../types";
import type { ShortcutMap } from "../shortcuts";
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from "../shortcuts";
import { createAnnotation, updateAnnotationNote } from "../annotations";
import type { ReadingPrefs } from "../readingPrefs";
import { DEFAULT_READING_PREFS, normalizeReadingPrefs } from "../readingPrefs";
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  nextTheme,
  normalizeTheme,
  themeLabel,
} from "../theme";
import {
  deleteAssetBlob,
  putAssetBlob,
  saveAssetMetaList,
} from "../assets/store";
import {
  markdownImageSnippet,
  relativeAssetHref,
  suggestAssetPath,
  extFromMime,
  sanitizeAssetFilename,
} from "../assets/paths";
import { applyDocMeta, getDocMeta } from "../docMeta";
import type { SavedSearch } from "../searchQuery";
import { docLinkNames, rewriteWikiLinksOnRename } from "../wikilink";
import { DEFAULT_HTML_PREVIEW_PREFS, normalizeHtmlPrefs } from "../htmlPreviewPrefs";
import { createSeedDocuments } from "../seed";
import { isImportableImagePath, isImportableLibraryPath, libraryDocTypeFromPath, mimeForImportableImage, normalizeImportedPath } from "../importable";
import { getTags, setHtmlTags, setMdTags } from "../tags";
import { basename, dirname, titleOf, uniquePath, uid, normalizeNewlines } from "../utils";
import { idbJSONStorage, STORE_KEY } from "../storage/idbPersist";
import { pushVersion, clearVersions } from "../storage/versions";
import { TRASH_RETENTION_DAYS } from "../storage/constants";
import {
  computeStorageUsage,
  measureLibraryBytes,
} from "../storage/usage";
import { ensureLibraryDir } from "../storage/fsSync";
import {
  blobToBase64,
  bulkWriteLibrary,
  deleteLibraryAsset,
  deleteLibraryDoc,
  ensureContentFolder,
  fetchLibrary,
  putLibraryAsset,
  purgeLibraryTrash,
  restoreLibraryTrash,
} from "../storage/contentApi";
import { stashIdbLibrary, takeIdbLibrary } from "../storage/contentMigration";
import {
  isPathUnderFolder,
  joinFolderPath,
  normalizeFolderPath,
  pruneEmptyFolders,
  removeFolderAndDescendants,
  sanitizeFolderSegment,
} from "../folders";
import { BUILTIN_TEMPLATES, applyTemplate, dailyNoteSpec } from "../templates";
import { nextActiveAfterClose, tabsToClose } from "../tabClose";
import type { LanghuanState } from "./types";
import { scheduleContentPersist } from "./helpers/persistSchedule";
import { ensureUniquePath } from "./helpers/paths";
import { softNavigate } from "./helpers/navigation";
import { filteredDocuments } from "./helpers/filteredDocuments";
import { createUiSlice } from "./slices/uiSlice";

export type {
  PendingReveal,
  SyncScrollPrefs,
  ScrollSyncEvent,
  PreviewLocateOpts,
  PendingPreviewLocate,
  TreeRevealRequest,
} from "./types";

export { filteredDocuments };

export const useStore = create<LanghuanState>()(
  persist(
    (...a) => {
      const [set, get] = a;
      return ({
        ...createUiSlice(...a),
        documents: [],
        drafts: {},
        trash: [],
        emptyFolders: [],
        activeId: null,
        viewMode: "preview",
        tagFilters: [],
        pendingReveal: null,
        pendingPreviewLocate: null,
        treeRevealRequest: null,
        pendingNav: null,
        htmlScrollPercent: 0,
        syncScrollByDoc: {},
        scrollSyncEvent: null,
        storageUsage: null,
        savedSearches: [],
        statusFilter: null,
        assets: [],
        annotations: [],
        openTabs: [],
        pinnedTabs: [],
        secondaryId: null,
        focusedPane: "primary",
        docSplitRatio: 0.5,
        treeSelection: [],
        batchMode: false,
        setTagFilters: (tags) => {
        const uniq = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
        set({ tagFilters: uniq });
      },
        toggleTagFilter: (tag) => {
        const t = tag.trim();
        if (!t) return;
        const cur = get().tagFilters;
        set({
          tagFilters: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
        });
      },
        clearTagFilters: () => set({ tagFilters: [] }),
        setViewMode: (m) => {
        const prev = get().viewMode;
        const pending = get().pendingReveal;
        // Opening source/split with a memorized preview locate: bump nonce so
        // the (possibly already-mounted, was-hidden) editor re-applies reveal.
        if (
          pending &&
          prev === "preview" &&
          (m === "split" || m === "source")
        ) {
          set({
            viewMode: m,
            pendingReveal: { ...pending, nonce: Date.now() },
          });
          return;
        }
        set({ viewMode: m });
      },
        setHtmlScrollPercent: (n) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
        set({ htmlScrollPercent: clamped });
      },
        getSyncScrollEnabled: (docId) => {
        const v = get().syncScrollByDoc[docId];
        return v !== false;
      },
        setSyncScrollEnabled: (docId, enabled) => {
        set((s) => ({
          syncScrollByDoc: { ...s.syncScrollByDoc, [docId]: enabled },
        }));
      },
        toggleSyncScroll: (docId) => {
        const cur = get().getSyncScrollEnabled(docId);
        get().setSyncScrollEnabled(docId, !cur);
        get().setStatus(!cur ? "已开启同步滚动" : "已关闭同步滚动");
      },
        publishScrollSync: (ev) => {
        set({
          scrollSyncEvent: { ...ev, nonce: Date.now() },
        });
      },
        clearScrollSyncEvent: () => set({ scrollSyncEvent: null }),
        applyLocateResult: (result, opts) => {
        if (result.precision === "none") {
          get().setStatus(result.message);
          return;
        }
        const viewMode = get().viewMode;
        const select = opts?.select ?? false;
        const focus = opts?.focus ?? select;
        const pending = {
          start: result.start,
          end: result.end,
          nonce: Date.now(),
          select,
          focus,
          highlight: opts?.highlight ?? true,
          center: opts?.center ?? true,
        };
        // Explicit 「定位源码」(select/focus): open split immediately so editors
        // mount/reveal. Plain preview remember (no select) still waits for 源码/分栏.
        // 框选 alone never calls this with select — only context menu / shortcuts.
        if (viewMode === "preview") {
          if (select || focus) {
            set({
              viewMode: "split",
              htmlImmersive: false,
              pendingReveal: pending,
              status: { message: result.message, at: Date.now() },
            });
            return;
          }
          set({
            pendingReveal: pending,
            status: {
              message: "已记住位置，点「源码」或「分栏」可查看",
              at: Date.now(),
            },
          });
          return;
        }
        set({
          pendingReveal: pending,
          status: { message: result.message, at: Date.now() },
        });
      },
        clearPendingReveal: () => set({ pendingReveal: null }),
        requestPreviewLocate: (offset, opts) => {
        set({
          pendingPreviewLocate: {
            offset,
            nonce: Date.now(),
            scroll: opts?.scroll === true,
            announce: opts?.announce === true,
          },
        });
      },
        clearPendingPreviewLocate: () => set({ pendingPreviewLocate: null }),
        requestTreeReveal: (docId) => {
        if (!docId) return;
        set({
          treeRevealRequest: { docId, nonce: Date.now() },
          sidebarPanel: "docs",
          sidebarOpen: true,
        });
      },
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
        importAssets: async (files, opts) => {
        let m = 0;
        const docs = get().documents;
        const nextAssets = [...get().assets];
        const pathSet = new Set<string>([
          ...docs.map((d) => d.path),
          ...nextAssets.map((a) => a.path),
        ]);

        for (const f of files) {
          let path = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
          if (!isImportableImagePath(path)) continue;
          path = uniquePath(path, pathSet);
          pathSet.add(path);

          const mime = mimeForImportableImage(path, f.mime);
          const blob =
            f.blob instanceof Blob ? f.blob : new Blob([f.blob], { type: mime });
          const id = uid("asset");
          // Prefer content/ on disk; IDB blob kept as offline cache fallback only.
          try {
            await putAssetBlob(id, blob);
          } catch {
            /* optional cache */
          }

          const dir = dirname(path);
          const sameDir = docs.filter((d) => dirname(d.path) === dir);
          const nearest =
            sameDir.find((d) => d.type === "md") ||
            sameDir.find((d) => /\.(html|svg)$/i.test(d.path)) ||
            undefined;

          const meta: AssetMeta = {
            id,
            path,
            mime,
            size: blob.size,
            createdAt: Date.now(),
            docId: nearest?.id,
          };
          nextAssets.push(meta);
          m += 1;

          try {
            const b64 = await blobToBase64(blob);
            await putLibraryAsset({
              path,
              base64: b64,
              mime,
              id,
              docId: nearest?.id,
              createdAt: meta.createdAt,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            get().setStatus(`附件写入 content/ 失败：${msg}`);
          }

          try {
            const { writeThroughAssetBinary } = await import("../storage/fsSync");
            void writeThroughAssetBinary(path, blob);
          } catch {
            /* optional mirror */
          }
        }

        if (m) {
          set({ assets: nextAssets });
          void saveAssetMetaList(nextAssets);
          void get().refreshStorageUsage();
          if (!opts?.quiet) get().setStatus(`已导入 ${m} 张图片`);
        }
        return m;
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
        deleteDoc: (id) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const item: TrashItem = { doc, deletedAt: Date.now() };
        set((s) => {
          const openTabs = s.openTabs.filter((t) => t !== id);
          const pinnedTabs = s.pinnedTabs.filter((t) => t !== id);
          const treeSelection = s.treeSelection.filter((t) => t !== id);
          let activeId = s.activeId === id ? null : s.activeId;
          if (s.activeId === id) {
            const idx = s.openTabs.indexOf(id);
            const fallback = openTabs[Math.min(idx, openTabs.length - 1)] || openTabs[0] || null;
            activeId = fallback;
          }
          return {
            documents: s.documents.filter((d) => d.id !== id),
            drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
            trash: [item, ...s.trash.filter((t) => t.doc.id !== id)],
            activeId,
            openTabs,
            pinnedTabs,
            treeSelection,
            secondaryId: s.secondaryId === id ? null : s.secondaryId,
          };
        });
        get().setStatus(`已移入回收站 ${basename(doc.path)}`);
        void deleteLibraryDoc(doc.path, "trash").catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          get().setStatus(`回收站同步失败：${msg}`);
        });
        void get().refreshStorageUsage();
      },
        deleteFolder: (folderPath) => {
        const folder = normalizeFolderPath(folderPath);
        if (!folder) {
          get().setStatus("不能删除库根目录");
          return 0;
        }
        const victims = get().documents.filter((d) =>
          isPathUnderFolder(d.path, folder)
        );
        const now = Date.now();
        const trashItems: TrashItem[] = victims.map((doc) => ({
          doc,
          deletedAt: now,
        }));
        const victimIds = new Set(victims.map((d) => d.id));

        set((s) => {
          const openTabs = s.openTabs.filter((t) => !victimIds.has(t));
          const pinnedTabs = s.pinnedTabs.filter((t) => !victimIds.has(t));
          const treeSelection = s.treeSelection.filter((t) => !victimIds.has(t));
          let activeId =
            s.activeId && victimIds.has(s.activeId) ? null : s.activeId;
          if (s.activeId && victimIds.has(s.activeId)) {
            const idx = s.openTabs.indexOf(s.activeId);
            const fallback =
              openTabs[Math.min(idx, openTabs.length - 1)] ||
              openTabs[0] ||
              null;
            activeId = fallback;
          }
          return {
            documents: s.documents.filter((d) => !victimIds.has(d.id)),
            drafts: Object.fromEntries(
              Object.entries(s.drafts).filter(([k]) => !victimIds.has(k))
            ),
            trash: [
              ...trashItems,
              ...s.trash.filter((t) => !victimIds.has(t.doc.id)),
            ],
            emptyFolders: removeFolderAndDescendants(s.emptyFolders, folder),
            activeId,
            openTabs,
            pinnedTabs,
            treeSelection,
            secondaryId:
              s.secondaryId && victimIds.has(s.secondaryId)
                ? null
                : s.secondaryId,
          };
        });

        const n = victims.length;
        get().setStatus(
          n
            ? `已删除文件夹 ${folder}（${n} 篇移入回收站）`
            : `已删除空文件夹 ${folder}`
        );
        for (const v of victims) {
          void deleteLibraryDoc(v.path, "trash").catch(() => {
            /* best-effort */
          });
        }
        void get().refreshStorageUsage();
        return n;
      },
        restoreFromTrash: (id) => {
        const item = get().trash.find((t) => t.doc.id === id);
        if (!item) return;
        let path = item.doc.path;
        path = ensureUniquePath(path, get().documents);
        const restored: Document = {
          ...item.doc,
          path,
          updatedAt: Date.now(),
        };
        set((s) => ({
          trash: s.trash.filter((t) => t.doc.id !== id),
          documents: [...s.documents, restored],
        }));
        get().setStatus(`已恢复 ${basename(restored.path)}`);
        void restoreLibraryTrash(id)
          .then((doc) => {
            if (doc.path !== restored.path) {
              set((s) => ({
                documents: s.documents.map((d) => (d.id === id ? { ...d, path: doc.path } : d)),
              }));
            }
          })
          .catch(() => {
            // Fallback: write restored doc directly
            scheduleContentPersist(get, set, restored);
          });
        void get().refreshStorageUsage();
      },
        purgeTrashItem: (id) => {
        const item = get().trash.find((t) => t.doc.id === id);
        set((s) => ({ trash: s.trash.filter((t) => t.doc.id !== id) }));
        if (item) void clearVersions(item.doc.id);
        get().setStatus(item ? `已彻底删除 ${basename(item.doc.path)}` : "已彻底删除");
        void purgeLibraryTrash(id).catch(() => {
          /* best-effort */
        });
        void get().refreshStorageUsage();
      },
        emptyTrash: () => {
        const ids = get().trash.map((t) => t.doc.id);
        set({ trash: [] });
        for (const id of ids) {
          void clearVersions(id);
          void purgeLibraryTrash(id).catch(() => {
            /* best-effort */
          });
        }
        get().setStatus("回收站已清空");
        void get().refreshStorageUsage();
      },
        purgeExpiredTrash: () => {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const expired = get().trash.filter((t) => t.deletedAt < cutoff);
        if (!expired.length) return 0;
        const keep = get().trash.filter((t) => t.deletedAt >= cutoff);
        set({ trash: keep });
        for (const t of expired) {
          void clearVersions(t.doc.id);
          void purgeLibraryTrash(t.doc.id).catch(() => {
            /* best-effort */
          });
        }
        void get().refreshStorageUsage();
        return expired.length;
      },
        toggleStar: (id) => {
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, starred: !d.starred } : d)),
        }));
        const doc = get().documents.find((d) => d.id === id);
        scheduleContentPersist(get, set, doc);
      },
        setDocTags: (id, tags) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const cur = get().getContent(id);
        const next = doc.type === "md" ? setMdTags(cur, tags) : setHtmlTags(cur, tags);
        const dirty = get().isDirty(id) || id in get().drafts;
        if (dirty) {
          set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
        } else {
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, content: next, updatedAt: Date.now() } : d
            ),
          }));
          scheduleContentPersist(get, set, get().documents.find((d) => d.id === id));
        }
      },
        resetSeed: () => {
        const seeds = createSeedDocuments();
        set({
          documents: seeds,
          drafts: {},
          activeId: null,
        });
        void bulkWriteLibrary({ documents: seeds, seed: true })
          .then(() => get().setStatus("已恢复示例文档到 content/"))
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            get().setStatus(`示例写入失败：${msg}`);
          });
        void get().refreshStorageUsage();
      },
        storageBytes: () => {
        const { documents, drafts, trash } = get();
        return measureLibraryBytes(documents, drafts, trash);
      },
        refreshStorageUsage: async () => {
        const { documents, drafts, trash } = get();
        try {
          const usage = await computeStorageUsage(documents, drafts, trash);
          set({ storageUsage: usage });
        } catch {
          /* ignore */
        }
      },
        setDocMeta: (id, patch) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const cur = get().getContent(id);
        const next = applyDocMeta(cur, doc.type, patch);
        const dirty = get().isDirty(id) || id in get().drafts;
        if (dirty) {
          set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
        } else {
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, content: next, updatedAt: Date.now() } : d
            ),
          }));
          scheduleContentPersist(get, set, get().documents.find((d) => d.id === id));
        }
      },
        setSavedSearches: (list) => set({ savedSearches: list }),
        addSavedSearch: (name, query) => {
        const n = name.trim();
        const q = query.trim();
        if (!n || !q) return;
        const item: SavedSearch = {
          id: uid("search"),
          name: n,
          query: q,
          createdAt: Date.now(),
        };
        set((s) => ({ savedSearches: [item, ...s.savedSearches].slice(0, 30) }));
        get().setStatus(`已保存搜索「${n}」`);
      },
        removeSavedSearch: (id) =>
        set((s) => ({ savedSearches: s.savedSearches.filter((x) => x.id !== id) })),
        setStatusFilter: (v) => set({ statusFilter: v }),
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
        applySyncedDocuments: (docs) => {
        const prevDrafts = get().drafts;
        const nextIds = new Set(docs.map((d) => d.id));
        const drafts = Object.fromEntries(
          Object.entries(prevDrafts).filter(([id]) => nextIds.has(id))
        );
        const activeId = get().activeId;
        set({
          documents: docs,
          drafts,
          activeId: activeId && nextIds.has(activeId) ? activeId : activeId,
        });
        // Mirror optional FS-Access sync result into primary content/
        void bulkWriteLibrary({ documents: docs, assets: get().assets }).catch(() => {});
        void get().refreshStorageUsage();
      },
        exportPayload: () => ({
        documents: get().documents,
        trash: get().trash,
        assets: get().assets,
        annotations: get().annotations,
        readingPrefs: get().readingPrefs,
      }),
        importLibrary: (payload, mode) => {
        if (mode === "replace") {
          const oldIds = get().documents.map((d) => d.id);
          const assets = payload.assets || [];
          set({
            documents: payload.documents,
            trash: payload.trash || [],
            drafts: {},
            activeId: null,
            assets,
            annotations: payload.annotations || [],
            readingPrefs: payload.readingPrefs
              ? normalizeReadingPrefs(payload.readingPrefs)
              : get().readingPrefs,
          });
          void saveAssetMetaList(assets);
          for (const id of oldIds) void clearVersions(id);
          void bulkWriteLibrary({
            documents: payload.documents,
            trash: payload.trash || [],
          }).catch(() => {});
          get().setStatus(`已替换导入 ${payload.documents.length} 篇文档`);
          void get().refreshStorageUsage();
          return payload.documents.length;
        }

        // merge: by path — overwrite content/meta if path exists, else add
        const byPath = new Map(get().documents.map((d) => [d.path, d]));
        let n = 0;
        const nextDocs = [...get().documents];
        for (const incoming of payload.documents) {
          const existing = byPath.get(incoming.path);
          if (existing) {
            const idx = nextDocs.findIndex((d) => d.id === existing.id);
            if (idx >= 0) {
              nextDocs[idx] = {
                ...existing,
                content: incoming.content,
                starred: incoming.starred,
                type: incoming.type,
                updatedAt: Date.now(),
              };
              n += 1;
            }
          } else {
            const doc: Document = {
              ...incoming,
              id: uid(),
              path: ensureUniquePath(incoming.path, nextDocs),
              updatedAt: Date.now(),
            };
            nextDocs.push(doc);
            byPath.set(doc.path, doc);
            n += 1;
          }
        }
        let nextAssets = [...get().assets];
        if (payload.assets?.length) {
          const byPath = new Map(nextAssets.map((a) => [a.path, a]));
          for (const a of payload.assets) {
            const ex = byPath.get(a.path);
            if (ex) {
              nextAssets = nextAssets.map((x) => (x.id === ex.id ? { ...a, id: ex.id } : x));
            } else {
              nextAssets.push(a);
              byPath.set(a.path, a);
            }
          }
        }
        let nextAnn = get().annotations;
        if (payload.annotations?.length) {
          const ids = new Set(nextAnn.map((a) => a.id));
          nextAnn = [
            ...nextAnn,
            ...payload.annotations.filter((a) => !ids.has(a.id)),
          ];
        }
        set({
          documents: nextDocs,
          assets: nextAssets,
          annotations: nextAnn,
        });
        void saveAssetMetaList(nextAssets);
        void bulkWriteLibrary({ documents: nextDocs }).catch(() => {});
        get().setStatus(`已合并导入 ${n} 篇文档`);
        void get().refreshStorageUsage();
        return n;
      },
        addAnnotation: (input) => {
        const ann = createAnnotation(input);
        set((s) => ({ annotations: [...s.annotations, ann] }));
        get().setStatus("已添加划线批注");
        return ann;
      },
        updateAnnotation: (id, patch) => {
        set((s) => ({
          annotations: s.annotations.map((a) => {
            if (a.id !== id) return a;
            let next = a;
            if (patch.note != null) next = updateAnnotationNote(next, patch.note);
            if (patch.color) next = { ...next, color: patch.color, updatedAt: Date.now() };
            return next;
          }),
        }));
      },
        removeAnnotation: (id) => {
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
        get().setStatus("已删除批注");
      },
        ingestImageFile: async (docId, file, filename) => {
        const doc = get().documents.find((d) => d.id === docId);
        if (!doc) return null;
        const mime = (file as File).type || "image/png";
        if (!mime.startsWith("image/")) {
          get().setStatus("仅支持图片附件");
          return null;
        }
        const name =
          filename ||
          (file as File).name ||
          `image.${extFromMime(mime)}`;
        const existing = [
          ...get().documents.map((d) => d.path),
          ...get().assets.map((a) => a.path),
        ];
        const path = suggestAssetPath(doc.path, sanitizeAssetFilename(name), existing);
        const id = uid("asset");
        const blob =
          file instanceof Blob ? file : new Blob([file], { type: mime });
        try {
          await putAssetBlob(id, blob);
        } catch {
          /* optional IDB cache */
        }
        const meta: AssetMeta = {
          id,
          path,
          mime,
          size: blob.size,
          createdAt: Date.now(),
          docId,
        };
        const assets = [...get().assets, meta];
        set({ assets });
        void saveAssetMetaList(assets);
        try {
          const b64 = await blobToBase64(blob);
          await putLibraryAsset({
            path,
            base64: b64,
            mime,
            id,
            docId,
            createdAt: meta.createdAt,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          get().setStatus(`附件写入 content/ 失败：${msg}`);
        }
        const href = relativeAssetHref(doc.path, path);
        const snippet = markdownImageSnippet(href, sanitizeAssetFilename(name).replace(/\.[^.]+$/, ""));
        get().setStatus(`已入库图片 ${basename(path)}`);
        void get().refreshStorageUsage();
        try {
          const { writeThroughAssetBinary } = await import("../storage/fsSync");
          void writeThroughAssetBinary(path, blob);
        } catch {
          /* optional mirror */
        }
        return { href, snippet, asset: meta };
      },
        removeAsset: (id) => {
        const victim = get().assets.find((a) => a.id === id);
        void deleteAssetBlob(id);
        const assets = get().assets.filter((a) => a.id !== id);
        set({ assets });
        void saveAssetMetaList(assets);
        if (victim) {
          void deleteLibraryAsset(victim.path).catch(() => {});
        }
        get().setStatus("已删除附件");
        void get().refreshStorageUsage();
      },
        openTab: (id) => {
        if (!get().documents.some((d) => d.id === id)) return;
        set((s) => ({
          openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
          activeId: id,
          focusedPane: "primary",
        }));
      },
        closeTab: (id) => {
        const { openTabs, pinnedTabs, activeId, secondaryId } = get();
        if (pinnedTabs.includes(id)) {
          get().setStatus("已固定的标签请先取消固定");
          return;
        }
        const next = openTabs.filter((t) => t !== id);
        let newActive = activeId;
        if (activeId === id) {
          const idx = openTabs.indexOf(id);
          newActive = next[Math.min(idx, next.length - 1)] || next[0] || null;
        }
        set({
          openTabs: next,
          activeId: newActive,
          secondaryId: secondaryId === id ? null : secondaryId,
        });
      },
        closeTabsInMode: (targetId, mode) => {
        const { openTabs, pinnedTabs, activeId, secondaryId } = get();
        if (!openTabs.includes(targetId)) return;
        const ids = tabsToClose(openTabs, pinnedTabs, targetId, mode);
        if (!ids.length) return;
        const closed = new Set(ids);
        const next = openTabs.filter((t) => !closed.has(t));
        const newActive = nextActiveAfterClose(openTabs, activeId, closed);
        set({
          openTabs: next,
          activeId: newActive,
          secondaryId: secondaryId && closed.has(secondaryId) ? null : secondaryId,
        });
      },
        togglePinTab: (id) => {
        set((s) => ({
          pinnedTabs: s.pinnedTabs.includes(id)
            ? s.pinnedTabs.filter((t) => t !== id)
            : [...s.pinnedTabs, id],
          openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
        }));
      },
        reorderTabs: (from, to) => {
        set((s) => {
          if (from < 0 || to < 0 || from >= s.openTabs.length || to >= s.openTabs.length) return s;
          const next = [...s.openTabs];
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          return { openTabs: next };
        });
      },
        setSecondaryId: (id) => set({ secondaryId: id }),
        setFocusedPane: (p) => set({ focusedPane: p }),
        setDocSplitRatio: (r) => {
        const clamped = Math.min(0.8, Math.max(0.2, r));
        set({ docSplitRatio: clamped });
      },
        openInSplit: (id) => {
        if (!get().documents.some((d) => d.id === id)) return;
        const cur = get().activeId;
        set((s) => {
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id];
          if (!cur || cur === id) {
            return { openTabs, secondaryId: id, focusedPane: "secondary" as FocusedPane };
          }
          return {
            openTabs,
            secondaryId: id,
            focusedPane: "secondary" as FocusedPane,
          };
        });
        get().setStatus("已在分屏打开");
      },
        toggleDocSplit: () => {
        const { secondaryId, activeId, openTabs } = get();
        if (secondaryId) {
          set({ secondaryId: null, focusedPane: "primary" });
          get().setStatus("已关闭文档分屏");
          return;
        }
        const other = openTabs.find((t) => t !== activeId) || null;
        if (!other) {
          get().setStatus("请先打开另一篇文档，或从侧栏「分屏打开」");
          return;
        }
        set({ secondaryId: other, focusedPane: "secondary" });
        get().setStatus("已开启文档分屏");
      },
        setTreeSelection: (ids) => set({ treeSelection: [...new Set(ids)] }),
        toggleTreeSelected: (id) => {
        set((s) => ({
          treeSelection: s.treeSelection.includes(id)
            ? s.treeSelection.filter((x) => x !== id)
            : [...s.treeSelection, id],
        }));
      },
        clearTreeSelection: () => set({ treeSelection: [] }),
        setBatchMode: (v) =>
        set({ batchMode: v, treeSelection: v ? get().treeSelection : [] }),
        moveDocsToFolder: (ids, folderPath) => {
        const folder = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        let n = 0;
        for (const id of ids) {
          const doc = get().documents.find((d) => d.id === id);
          if (!doc) continue;
          const name = basename(doc.path);
          const nextPath = folder ? `${folder}/${name}` : name;
          if (nextPath === doc.path) continue;
          get().renameDoc(id, nextPath);
          n += 1;
        }
        if (n) get().setStatus(`已移动 ${n} 篇到 ${folder || "根目录"}`);
        get().clearTreeSelection();
        return n;
      },
        batchDelete: (ids) => {
        let n = 0;
        for (const id of [...ids]) {
          if (get().documents.some((d) => d.id === id)) {
            get().deleteDoc(id);
            n += 1;
          }
        }
        get().clearTreeSelection();
        if (n) get().setStatus(`已将 ${n} 篇移入回收站`);
        return n;
      },
        batchSetTags: (ids, tags, mode) => {
        const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
        let n = 0;
        for (const id of ids) {
          const doc = get().documents.find((d) => d.id === id);
          if (!doc) continue;
          const cur = getTags(doc);
          const next =
            mode === "replace" ? clean : [...new Set([...cur, ...clean])];
          get().setDocTags(id, next);
          n += 1;
        }
        if (n) get().setStatus(`已为 ${n} 篇更新标签`);
        return n;
      },
        assetsForDoc: (docId) => {
        const doc = get().documents.find((d) => d.id === docId);
        const all = get().assets;
        if (!doc) return all.filter((a) => a.docId === docId);
        const dir = doc.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
        return all.filter(
          (a) =>
            a.docId === docId ||
            a.path.startsWith(dir ? dir + "/assets/" : "assets/") ||
            a.path.includes("/assets/")
        );
      },
        hydrateFromContent: async () => {
        try {
          const snap = await fetchLibrary();
          const pending = takeIdbLibrary();
          if (snap.documents.length || snap.assets.length || snap.trash.length) {
            set({
              documents: snap.documents,
              assets: snap.assets,
              trash: snap.trash,
            });
            void saveAssetMetaList(snap.assets);
            get().setStatus(`已从 content/ 载入 ${snap.documents.length} 篇`);
            void get().refreshStorageUsage();
            return;
          }
          if (pending && (pending.documents.length || pending.assets.length)) {
            // One-shot migrate IDB library → content/
            const assetPayload = [];
            for (const a of pending.assets) {
              try {
                const { getAssetBlob } = await import("../assets/store");
                const blob = await getAssetBlob(a.id);
                if (blob) {
                  const b64 = await blobToBase64(blob);
                  assetPayload.push({ ...a, base64: b64 });
                } else {
                  assetPayload.push(a);
                }
              } catch {
                assetPayload.push(a);
              }
            }
            const written = await bulkWriteLibrary({
              documents: pending.documents,
              assets: assetPayload,
              trash: pending.trash,
            });
            set({
              documents: written.documents,
              assets: written.assets,
              trash: written.trash,
            });
            void saveAssetMetaList(written.assets);
            get().setStatus(`已将浏览器旧库迁移到 content/（${written.documents.length} 篇）`);
            void get().refreshStorageUsage();
            return;
          }
          // Empty content/ — seed once
          const seeds = createSeedDocuments();
          const written = await bulkWriteLibrary({ documents: seeds, seed: true });
          set({
            documents: written.documents.length ? written.documents : seeds,
            assets: written.assets,
            trash: written.trash,
          });
          get().setStatus("已初始化示例文档到 content/");
          void get().refreshStorageUsage();
        } catch (e) {
          const pending = takeIdbLibrary();
          if (pending && pending.documents.length) {
            set({
              documents: pending.documents,
              assets: pending.assets,
              trash: pending.trash,
            });
            get().setStatus("content/ API 不可用，暂用浏览器旧数据");
          } else if (!get().documents.length) {
            set({ documents: createSeedDocuments() });
            get().setStatus("content/ API 不可用，使用内存示例库");
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            get().setStatus(`载入 content/ 失败：${msg}`);
          }
        }
      },
      });
    },
    {
      name: STORE_KEY,
      storage: idbJSONStorage,
      partialize: (s) => ({
        // documents / trash / assets live in content/ — IDB keeps UI prefs only
        drafts: s.drafts,
        emptyFolders: s.emptyFolders,
        theme: s.theme,
        viewMode: s.viewMode,
        activeId: s.activeId,
        splitRatio: s.splitRatio,
        splitSourceFirst: s.splitSourceFirst,
        syncScrollByDoc: s.syncScrollByDoc,
        sidebarWidth: s.sidebarWidth,
        outlineWidth: s.outlineWidth,
        outlineRailOpen: s.outlineRailOpen,
        tagFilters: s.tagFilters,
        htmlPreviewPrefs: s.htmlPreviewPrefs,
        lastBackupAt: s.lastBackupAt,
        autosaveEnabled: s.autosaveEnabled,
        fsBoundName: s.fsBoundName,
        fsLastSyncAt: s.fsLastSyncAt,
        savedSearches: s.savedSearches,
        statusFilter: s.statusFilter,
        annotations: s.annotations,
        readingPrefs: s.readingPrefs,
        mdFocusMode: s.mdFocusMode,
        openTabs: s.openTabs,
        pinnedTabs: s.pinnedTabs,
        secondaryId: s.secondaryId,
        docSplitRatio: s.docSplitRatio,
        customShortcuts: s.customShortcuts,
      }),
      version: 9,
      migrate: (persisted, fromVersion) => {
        const p = (persisted || {}) as Record<string, unknown>;
        if (fromVersion < 9) {
          stashIdbLibrary({
            documents: Array.isArray(p.documents) ? (p.documents as Document[]) : [],
            assets: Array.isArray(p.assets) ? (p.assets as AssetMeta[]) : [],
            trash: Array.isArray(p.trash) ? (p.trash as TrashItem[]) : [],
          });
          // Stop carrying library bodies in the persisted blob
          delete p.documents;
          delete p.assets;
          delete p.trash;
        }
        if (Array.isArray(p.tagFilters)) {
          p.tagFilters = [...new Set((p.tagFilters as unknown[]).map(String).filter(Boolean))];
        } else if (typeof p.tagFilter === "string" && p.tagFilter) {
          p.tagFilters = [p.tagFilter];
        } else if (!Array.isArray(p.tagFilters)) {
          p.tagFilters = [];
        }
        delete p.tagFilter;
        if (!Array.isArray(p.trash)) p.trash = [];
        if (!Array.isArray(p.emptyFolders)) p.emptyFolders = [];
        else {
          p.emptyFolders = pruneEmptyFolders(
            (p.emptyFolders as string[]).map(String),
            Array.isArray(p.documents)
              ? (p.documents as { path?: string }[]).map((d) => String(d?.path || ""))
              : []
          );
        }
        if (typeof p.autosaveEnabled !== "boolean") p.autosaveEnabled = true;
        if (p.lastBackupAt != null && typeof p.lastBackupAt !== "number") p.lastBackupAt = null;
        if (p.fsBoundName != null && typeof p.fsBoundName !== "string") p.fsBoundName = null;
        if (p.fsLastSyncAt != null && typeof p.fsLastSyncAt !== "number") p.fsLastSyncAt = null;
        if (!("fsBoundName" in p)) p.fsBoundName = null;
        if (!("fsLastSyncAt" in p)) p.fsLastSyncAt = null;
        if (!Array.isArray(p.savedSearches)) p.savedSearches = [];
        if (!("statusFilter" in p)) p.statusFilter = null;
        if (!Array.isArray(p.assets)) p.assets = [];
        if (!Array.isArray(p.annotations)) p.annotations = [];
        p.readingPrefs = normalizeReadingPrefs(
          (p.readingPrefs as Partial<ReadingPrefs>) || DEFAULT_READING_PREFS
        );
        if (typeof p.mdFocusMode !== "boolean") {
          p.mdFocusMode = !!(p.readingPrefs as ReadingPrefs).focusMode;
        }
        if (!Array.isArray(p.openTabs)) p.openTabs = [];
        if (!Array.isArray(p.pinnedTabs)) p.pinnedTabs = [];
        if (!("secondaryId" in p)) p.secondaryId = null;
        if (typeof p.docSplitRatio !== "number") p.docSplitRatio = 0.5;
        if (!p.syncScrollByDoc || typeof p.syncScrollByDoc !== "object") p.syncScrollByDoc = {};
        p.customShortcuts = normalizeShortcuts(
          (p.customShortcuts as Partial<ShortcutMap>) || {}
        );
        // store only overrides; strip identical defaults later on read
        {
          const full = p.customShortcuts as ShortcutMap;
          const overrides: Partial<ShortcutMap> = {};
          (Object.keys(DEFAULT_SHORTCUTS) as (keyof ShortcutMap)[]).forEach((k) => {
            if (full[k] && full[k] !== DEFAULT_SHORTCUTS[k]) overrides[k] = full[k];
          });
          p.customShortcuts = overrides;
        }
        // N-langhuan-themes-5: paper→xuan, ink→songyan
        p.theme = normalizeTheme(p.theme);
        void fromVersion;
        return p as typeof persisted;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state?.theme && typeof document !== "undefined") {
          const id = normalizeTheme(state.theme);
          if (id !== state.theme) state.theme = id;
          applyThemeToDocument(id);
          try {
            localStorage.setItem(THEME_STORAGE_KEY, id);
          } catch {
            /* ignore */
          }
        }
        if (state) {
          if (typeof state.sidebarWidth === "number") {
            state.setSidebarWidth(state.sidebarWidth);
          }
          if (typeof state.outlineRailOpen !== "boolean") {
            state.setOutlineRailOpen(true);
          }
          void state.hydrateFromContent().then(() => {
            const purged = state.purgeExpiredTrash();
            if (purged > 0) {
              state.setStatus(`已自动清理 ${purged} 篇过期回收站文档`);
            }
            void state.refreshStorageUsage();
          });
        }
      },
    }
  )
);

