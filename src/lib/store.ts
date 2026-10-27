"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Document,
  PendingNav,
  StatusFeedback,
  ThemeMode,
  TrashItem,
  ViewMode,
} from "./types";
import type { DocMeta, DocStatus } from "./docMeta";
import { applyDocMeta, getDocMeta, matchesStatusFilter } from "./docMeta";
import type { SavedSearch } from "./searchQuery";
import { docLinkNames, rewriteWikiLinksOnRename } from "./wikilink";
import type { HtmlDocPreviewPrefs } from "./htmlPreviewPrefs";
import { DEFAULT_HTML_PREVIEW_PREFS, normalizeHtmlPrefs } from "./htmlPreviewPrefs";
import type { LocateResult } from "./locate/types";
import { createSeedDocuments } from "./seed";
import { isImportableLibraryPath, libraryDocTypeFromPath, normalizeImportedPath } from "./importable";
import { getTags, setHtmlTags, setMdTags } from "./tags";
import { basename, titleOf, uniquePath, uid } from "./utils";
import { idbJSONStorage, STORE_KEY } from "./storage/idbPersist";
import { pushVersion, clearVersions } from "./storage/versions";
import { TRASH_RETENTION_DAYS } from "./storage/constants";
import {
  computeStorageUsage,
  measureLibraryBytes,
  type StorageUsage,
} from "./storage/usage";
import type { BackupPayload } from "./storage/backup";
import { writeThroughDoc } from "./storage/fsSync";
import { BUILTIN_TEMPLATES, applyTemplate, dailyNoteSpec } from "./templates";

export type PendingReveal = {
  start: number;
  end: number;
  nonce: number;
};

export type PendingPreviewLocate = {
  offset: number;
  nonce: number;
};

type LanghuanState = {
  hydrated: boolean;
  documents: Document[];
  drafts: Record<string, string>;
  trash: TrashItem[];
  activeId: string | null;
  viewMode: ViewMode;
  theme: ThemeMode;
  tagFilters: string[];
  sidebarOpen: boolean;
  commandOpen: boolean;
  status: StatusFeedback;
  pendingReveal: PendingReveal | null;
  pendingPreviewLocate: PendingPreviewLocate | null;
  pendingNav: PendingNav;
  /** Fraction of split space for the source pane (0.2–0.8). */
  splitRatio: number;
  /** When true, source is on the left (or top on small screens). */
  splitSourceFirst: boolean;
  /** Desktop sidebar width in px (240–360). */
  sidebarWidth: number;
  /** Markdown outline/backlinks panel width in px (160–360). */
  outlineWidth: number;
  /** Whether the MD outline/backlinks rail is preferred open (persisted). */
  outlineRailOpen: boolean;
  /** Sidebar middle panel: docs tree | tags | starred | trash. */
  sidebarPanel: "docs" | "tags" | "stars" | "trash";
  /** HTML preview immersive reading mode (session). */
  htmlImmersive: boolean;
  /** HTML: temporary full sidebar overlay over content (session). */
  htmlSidebarPeek: boolean;
  /** Scroll percent reported by HTML preview bridge (0–100). */
  htmlScrollPercent: number;
  /** Source editor caret (1-based), for status bar Ln/Col. */
  editorCaret: { line: number; col: number } | null;
  /** Per-document HTML preview chrome prefs (width sim / zoom). */
  htmlPreviewPrefs: Record<string, HtmlDocPreviewPrefs>;
  /** Bump to force HTML iframe remount/refresh. */
  htmlReloadToken: number;
  /** Last successful full-library export timestamp. */
  lastBackupAt: number | null;
  /** Debounced autosave drafts → saved docs (default on). */
  autosaveEnabled: boolean;
  /** UI flag to open backup dialog. */
  backupDialogOpen: boolean;
  /** UI flag to open version history for active doc. */
  versionDialogOpen: boolean;
  /** Cached storage usage (refreshed async). */
  storageUsage: StorageUsage | null;
  /** Bound local folder display name (handle itself in IDB). */
  fsBoundName: string | null;
  /** Last successful folder sync timestamp. */
  fsLastSyncAt: number | null;
  /** UI flag for local folder sync dialog. */
  fsSyncDialogOpen: boolean;

  /** Saved named search queries. */
  savedSearches: SavedSearch[];
  /** Document status filter (null = off; "todo" = 待整理). */
  statusFilter: DocStatus | "todo" | null;
  /** Knowledge graph dialog. */
  graphDialogOpen: boolean;
  /** Properties panel for active doc. */
  propsDialogOpen: boolean;
  /** URL clipper dialog. */
  clipUrlDialogOpen: boolean;
  /** Template picker dialog. */
  templateDialogOpen: boolean;

  setHydrated: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setTagFilters: (tags: string[]) => void;
  toggleTagFilter: (tag: string) => void;
  clearTagFilters: () => void;
  setViewMode: (m: ViewMode) => void;
  setSplitRatio: (r: number) => void;
  setSplitSourceFirst: (v: boolean) => void;
  toggleSplitSourceFirst: () => void;
  setSidebarWidth: (w: number) => void;
  setOutlineWidth: (w: number) => void;
  setOutlineRailOpen: (v: boolean) => void;
  toggleOutlineRail: () => void;
  setSidebarPanel: (p: "docs" | "tags" | "stars" | "trash") => void;
  setHtmlImmersive: (v: boolean) => void;
  toggleHtmlImmersive: () => void;
  setHtmlSidebarPeek: (v: boolean) => void;
  setHtmlScrollPercent: (n: number) => void;
  setEditorCaret: (c: { line: number; col: number } | null) => void;
  getHtmlPreviewPrefs: (id: string) => HtmlDocPreviewPrefs;
  setHtmlPreviewPrefs: (id: string, patch: Partial<HtmlDocPreviewPrefs>) => void;
  bumpHtmlReload: () => void;
  setStatus: (message: string) => void;
  applyLocateResult: (result: LocateResult) => void;
  clearPendingReveal: () => void;
  requestPreviewLocate: (offset: number) => void;
  clearPendingPreviewLocate: () => void;
  openHome: () => void;
  openDoc: (id: string) => void;
  /** Like openDoc/openHome but blocks when current doc is dirty. */
  requestOpenDoc: (id: string) => void;
  requestOpenHome: () => void;
  resolvePendingNav: (action: "save" | "discard" | "cancel") => void;
  getActive: () => Document | null;
  getContent: (id: string) => string;
  isDirty: (id: string) => boolean;
  anyDirty: () => boolean;
  setDraft: (id: string, content: string) => void;
  saveDoc: (id?: string) => void;
  discardDraft: (id?: string) => void;
  createDoc: (opts: {
    type: Document["type"];
    path?: string;
    content?: string;
    open?: boolean;
  }) => Document;
  importFiles: (files: { path: string; content: string }[]) => number;
  renameDoc: (id: string, newPath: string) => void;
  /** Soft-delete → recycle bin. */
  deleteDoc: (id: string) => void;
  restoreFromTrash: (id: string) => void;
  purgeTrashItem: (id: string) => void;
  emptyTrash: () => void;
  purgeExpiredTrash: () => number;
  toggleStar: (id: string) => void;
  setDocTags: (id: string, tags: string[]) => void;
  resetSeed: () => void;
  storageBytes: () => number;
  refreshStorageUsage: () => Promise<void>;
  setLastBackupAt: (t: number | null) => void;
  setAutosaveEnabled: (v: boolean) => void;
  setBackupDialogOpen: (v: boolean) => void;
  setVersionDialogOpen: (v: boolean) => void;
  setFsSyncDialogOpen: (v: boolean) => void;
  setFsBoundName: (name: string | null) => void;
  setFsLastSyncAt: (t: number | null) => void;
  /** Apply documents returned from a folder sync-in (preserves drafts for untouched ids). */
  applySyncedDocuments: (docs: Document[]) => void;
  /** Replace or merge library from backup payload. */
  importLibrary: (payload: BackupPayload, mode: "merge" | "replace") => number;
  exportPayload: () => BackupPayload;
  setDocMeta: (id: string, patch: Partial<DocMeta>) => void;
  setSavedSearches: (list: SavedSearch[]) => void;
  addSavedSearch: (name: string, query: string) => void;
  removeSavedSearch: (id: string) => void;
  setStatusFilter: (v: DocStatus | "todo" | null) => void;
  setGraphDialogOpen: (v: boolean) => void;
  setPropsDialogOpen: (v: boolean) => void;
  setClipUrlDialogOpen: (v: boolean) => void;
  setTemplateDialogOpen: (v: boolean) => void;
  /** Open or create today's daily note. */
  openDailyNote: () => Document;
  createFromTemplate: (templateId: string, title?: string) => Document | null;
};

function scheduleWriteThrough(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, doc: Document | undefined) {
  if (!doc || !get().fsBoundName) return;
  void writeThroughDoc(doc)
    .then((ok) => {
      if (ok) set({ fsLastSyncAt: Date.now() });
    })
    .catch(() => {
      /* best-effort */
    });
}

function ensureUniquePath(path: string, docs: Document[], exceptId?: string): string {
  const set = new Set(docs.filter((d) => d.id !== exceptId).map((d) => d.path));
  return uniquePath(path, set);
}

function softNavigate(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, next: NonNullable<PendingNav>) {
  const cur = get().activeId;
  if (cur && get().isDirty(cur)) {
    if (next.kind === "doc" && next.id === cur) return;
    set({ pendingNav: next });
    return;
  }
  if (next.kind === "home") get().openHome();
  else get().openDoc(next.id);
}

export const useStore = create<LanghuanState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      documents: createSeedDocuments(),
      drafts: {},
      trash: [],
      activeId: null,
      viewMode: "preview",
      theme: "paper",
      tagFilters: [],
      sidebarOpen: false,
      commandOpen: false,
      status: null,
      pendingReveal: null,
      pendingPreviewLocate: null,
      pendingNav: null,
      splitRatio: 0.5,
      splitSourceFirst: true,
      sidebarWidth: 280,
      outlineWidth: 240,
      outlineRailOpen: true,
      sidebarPanel: "docs",
      htmlImmersive: false,
      htmlSidebarPeek: false,
      htmlScrollPercent: 0,
      editorCaret: null,
      htmlPreviewPrefs: {},
      htmlReloadToken: 0,
      lastBackupAt: null,
      autosaveEnabled: true,
      backupDialogOpen: false,
      versionDialogOpen: false,
      storageUsage: null,
      fsBoundName: null,
      fsLastSyncAt: null,
      fsSyncDialogOpen: false,
      savedSearches: [],
      statusFilter: null,
      graphDialogOpen: false,
      propsDialogOpen: false,
      clipUrlDialogOpen: false,
      templateDialogOpen: false,

      setHydrated: (v) => set({ hydrated: v }),
      setTheme: (t) => {
        set({ theme: t });
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", t === "ink");
        }
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("langhuan-theme", t);
          }
        } catch {
          /* ignore */
        }
      },
      toggleTheme: () => {
        const next = get().theme === "paper" ? "ink" : "paper";
        get().setTheme(next);
        get().setStatus(next === "ink" ? "已切换到墨色主题" : "已切换到纸色主题");
      },
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setCommandOpen: (v) => set({ commandOpen: v }),
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
      setViewMode: (m) => set({ viewMode: m }),
      setSplitRatio: (r) => {
        const clamped = Math.min(0.8, Math.max(0.2, r));
        set({ splitRatio: clamped });
      },
      setSplitSourceFirst: (v) => set({ splitSourceFirst: v }),
      toggleSplitSourceFirst: () => {
        const next = !get().splitSourceFirst;
        set({ splitSourceFirst: next });
        get().setStatus(next ? "分栏：源码在左" : "分栏：预览在左");
      },
      setSidebarWidth: (w) => {
        const clamped = Math.min(360, Math.max(240, Math.round(w)));
        set({ sidebarWidth: clamped });
      },
      setOutlineWidth: (w) => {
        const clamped = Math.min(360, Math.max(160, Math.round(w)));
        set({ outlineWidth: clamped });
      },
      setOutlineRailOpen: (v) => set({ outlineRailOpen: v }),
      toggleOutlineRail: () => {
        const next = !get().outlineRailOpen;
        set({ outlineRailOpen: next });
        get().setStatus(next ? "已显示大纲栏" : "已隐藏大纲栏");
      },
      setSidebarPanel: (p) => set({ sidebarPanel: p }),
      setHtmlImmersive: (v) =>
        set({
          htmlImmersive: v,
          htmlSidebarPeek: v ? false : get().htmlSidebarPeek,
        }),
      toggleHtmlImmersive: () => {
        const next = !get().htmlImmersive;
        get().setHtmlImmersive(next);
        get().setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
      },
      setHtmlSidebarPeek: (v) => set({ htmlSidebarPeek: v }),
      setHtmlScrollPercent: (n) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
        set({ htmlScrollPercent: clamped });
      },
      setEditorCaret: (c) => set({ editorCaret: c }),
      getHtmlPreviewPrefs: (id) =>
        normalizeHtmlPrefs(get().htmlPreviewPrefs[id] || DEFAULT_HTML_PREVIEW_PREFS),
      setHtmlPreviewPrefs: (id, patch) => {
        const cur = normalizeHtmlPrefs(get().htmlPreviewPrefs[id]);
        const next = normalizeHtmlPrefs({ ...cur, ...patch });
        set((s) => ({
          htmlPreviewPrefs: { ...s.htmlPreviewPrefs, [id]: next },
        }));
      },
      bumpHtmlReload: () => set((s) => ({ htmlReloadToken: s.htmlReloadToken + 1 })),
      setStatus: (message) => set({ status: { message, at: Date.now() } }),

      applyLocateResult: (result) => {
        if (result.precision === "none") {
          get().setStatus(result.message);
          return;
        }
        const viewMode = get().viewMode;
        if (viewMode === "preview") {
          set({ viewMode: "split" });
        }
        set({
          pendingReveal: {
            start: result.start,
            end: result.end,
            nonce: Date.now(),
          },
          status: { message: result.message, at: Date.now() },
        });
      },

      clearPendingReveal: () => set({ pendingReveal: null }),

      requestPreviewLocate: (offset) => {
        set({
          pendingPreviewLocate: { offset, nonce: Date.now() },
        });
      },

      clearPendingPreviewLocate: () => set({ pendingPreviewLocate: null }),

      openHome: () =>
        set({
          activeId: null,
          htmlImmersive: false,
          htmlSidebarPeek: false,
          htmlScrollPercent: 0,
          editorCaret: null,
        }),
      openDoc: (id) => {
        set({
          activeId: id,
          sidebarOpen: false,
          htmlImmersive: false,
          htmlSidebarPeek: false,
          htmlScrollPercent: 0,
          editorCaret: null,
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
        if (id in drafts) return drafts[id];
        return documents.find((d) => d.id === id)?.content ?? "";
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
        scheduleWriteThrough(get, set, doc);
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
        set((s) => ({
          documents: [...s.documents, doc],
          activeId: open ? doc.id : s.activeId,
          viewMode: open ? "source" : s.viewMode,
        }));
        get().setStatus(`已新建 ${basename(doc.path)}`);
        void get().refreshStorageUsage();
        scheduleWriteThrough(get, set, doc);
        return doc;
      },

      importFiles: (files) => {
        let n = 0;
        const docs = [...get().documents];
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
          n += 1;
        }
        set({ documents: docs });
        if (n) get().setStatus(`已导入 ${n} 个文件`);
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
        set({ documents, drafts });
        const msg =
          linkUpdates > 0
            ? `已重命名为 ${basename(path)}，并更新 ${linkUpdates} 处双链`
            : `已重命名为 ${basename(path)}`;
        get().setStatus(msg);
        const renamed = get().documents.find((d) => d.id === id);
        scheduleWriteThrough(get, set, renamed);
        if (linkUpdates > 0) {
          for (const d of get().documents) {
            if (d.id !== id && d.type === "md") scheduleWriteThrough(get, set, d);
          }
        }
      },

      deleteDoc: (id) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const item: TrashItem = { doc, deletedAt: Date.now() };
        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id),
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
          trash: [item, ...s.trash.filter((t) => t.doc.id !== id)],
          activeId: s.activeId === id ? null : s.activeId,
        }));
        get().setStatus(`已移入回收站 ${basename(doc.path)}`);
        void get().refreshStorageUsage();
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
        void get().refreshStorageUsage();
      },

      purgeTrashItem: (id) => {
        const item = get().trash.find((t) => t.doc.id === id);
        set((s) => ({ trash: s.trash.filter((t) => t.doc.id !== id) }));
        if (item) void clearVersions(item.doc.id);
        get().setStatus(item ? `已彻底删除 ${basename(item.doc.path)}` : "已彻底删除");
        void get().refreshStorageUsage();
      },

      emptyTrash: () => {
        const ids = get().trash.map((t) => t.doc.id);
        set({ trash: [] });
        for (const id of ids) void clearVersions(id);
        get().setStatus("回收站已清空");
        void get().refreshStorageUsage();
      },

      purgeExpiredTrash: () => {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const expired = get().trash.filter((t) => t.deletedAt < cutoff);
        if (!expired.length) return 0;
        const keep = get().trash.filter((t) => t.deletedAt >= cutoff);
        set({ trash: keep });
        for (const t of expired) void clearVersions(t.doc.id);
        void get().refreshStorageUsage();
        return expired.length;
      },

      toggleStar: (id) => {
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, starred: !d.starred } : d)),
        }));
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
          scheduleWriteThrough(get, set, get().documents.find((d) => d.id === id));
        }
      },

      resetSeed: () => {
        set({
          documents: createSeedDocuments(),
          drafts: {},
          activeId: null,
        });
        get().setStatus("已恢复示例文档");
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

      setLastBackupAt: (t) => set({ lastBackupAt: t }),
      setAutosaveEnabled: (v) => {
        set({ autosaveEnabled: v });
        get().setStatus(v ? "已开启自动保存" : "已关闭自动保存");
      },
      setBackupDialogOpen: (v) => set({ backupDialogOpen: v }),
      setVersionDialogOpen: (v) => set({ versionDialogOpen: v }),
      setFsSyncDialogOpen: (v) => set({ fsSyncDialogOpen: v }),
      setFsBoundName: (name) => set({ fsBoundName: name }),
      setFsLastSyncAt: (t) => set({ fsLastSyncAt: t }),

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
          scheduleWriteThrough(get, set, get().documents.find((d) => d.id === id));
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
      setGraphDialogOpen: (v) => set({ graphDialogOpen: v }),
      setPropsDialogOpen: (v) => set({ propsDialogOpen: v }),
      setClipUrlDialogOpen: (v) => set({ clipUrlDialogOpen: v }),
      setTemplateDialogOpen: (v) => set({ templateDialogOpen: v }),

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
        void get().refreshStorageUsage();
      },

      exportPayload: () => ({
        documents: get().documents,
        trash: get().trash,
      }),

      importLibrary: (payload, mode) => {
        if (mode === "replace") {
          const oldIds = get().documents.map((d) => d.id);
          set({
            documents: payload.documents,
            trash: payload.trash || [],
            drafts: {},
            activeId: null,
          });
          for (const id of oldIds) void clearVersions(id);
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
        set({ documents: nextDocs });
        get().setStatus(`已合并导入 ${n} 篇文档`);
        void get().refreshStorageUsage();
        return n;
      },
    }),
    {
      name: STORE_KEY,
      storage: idbJSONStorage,
      partialize: (s) => ({
        documents: s.documents,
        drafts: s.drafts,
        trash: s.trash,
        theme: s.theme,
        viewMode: s.viewMode,
        activeId: s.activeId,
        splitRatio: s.splitRatio,
        splitSourceFirst: s.splitSourceFirst,
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
      }),
      version: 4,
      migrate: (persisted, fromVersion) => {
        const p = (persisted || {}) as Record<string, unknown>;
        if (Array.isArray(p.tagFilters)) {
          p.tagFilters = [...new Set((p.tagFilters as unknown[]).map(String).filter(Boolean))];
        } else if (typeof p.tagFilter === "string" && p.tagFilter) {
          p.tagFilters = [p.tagFilter];
        } else if (!Array.isArray(p.tagFilters)) {
          p.tagFilters = [];
        }
        delete p.tagFilter;
        if (!Array.isArray(p.trash)) p.trash = [];
        if (typeof p.autosaveEnabled !== "boolean") p.autosaveEnabled = true;
        if (p.lastBackupAt != null && typeof p.lastBackupAt !== "number") p.lastBackupAt = null;
        if (p.fsBoundName != null && typeof p.fsBoundName !== "string") p.fsBoundName = null;
        if (p.fsLastSyncAt != null && typeof p.fsLastSyncAt !== "number") p.fsLastSyncAt = null;
        if (!("fsBoundName" in p)) p.fsBoundName = null;
        if (!("fsLastSyncAt" in p)) p.fsLastSyncAt = null;
        if (!Array.isArray(p.savedSearches)) p.savedSearches = [];
        if (!("statusFilter" in p)) p.statusFilter = null;
        void fromVersion;
        return p as typeof persisted;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state?.theme && typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", state.theme === "ink");
          try {
            localStorage.setItem("langhuan-theme", state.theme);
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
          const purged = state.purgeExpiredTrash();
          if (purged > 0) {
            state.setStatus(`已自动清理 ${purged} 篇过期回收站文档`);
          }
          void state.refreshStorageUsage();
        }
      },
    }
  )
);

export function filteredDocuments(
  docs: Document[],
  tagFilters: string[] | null | undefined,
  statusFilter?: DocStatus | "todo" | null
): Document[] {
  const filters = (tagFilters || []).map((t) => t.trim()).filter(Boolean);
  return docs.filter((d) => {
    if (filters.length) {
      const tags = getTags(d);
      if (!filters.every((t) => tags.includes(t))) return false;
    }
    if (statusFilter && !matchesStatusFilter(d, statusFilter)) return false;
    return true;
  });
}
