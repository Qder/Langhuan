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
import { createLocateSlice } from "./slices/locateSlice";
import { createSearchMetaSlice } from "./slices/searchMetaSlice";
import { createTrashSlice } from "./slices/trashSlice";
import { createTabsSlice } from "./slices/tabsSlice";
import { createAssetsSlice } from "./slices/assetsSlice";
import { createSyncBackupSlice } from "./slices/syncBackupSlice";

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
        ...createLocateSlice(...a),
        ...createSearchMetaSlice(...a),
        ...createTrashSlice(...a),
        ...createTabsSlice(...a),
        ...createAssetsSlice(...a),
        ...createSyncBackupSlice(...a),
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

