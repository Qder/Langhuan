"use client";

import type {
  AssetMeta,
  Document,
  FocusedPane,
  PendingNav,
  StatusFeedback,
  ThemeMode,
  TrashItem,
  ViewMode,
} from "../types";
import type { ShortcutMap } from "../shortcuts";
import type { Annotation, AnnotationInput } from "../annotations";
import type { QuizDoc, QuizItemState } from "../quiz";
import type { ReadingPrefs } from "../readingPrefs";
import type { DocMeta, DocStatus } from "../docMeta";
import type { SavedSearch } from "../searchQuery";
import type { HtmlDocPreviewPrefs } from "../htmlPreviewPrefs";
import type { LocateResult } from "../locate/types";
import type { StorageUsage } from "../storage/usage";
import type { BackupPayload } from "../storage/backup";
import type { TabCloseMode } from "../tabClose";

export type PendingReveal = {
  start: number;
  end: number;
  nonce: number;
  /** Select the range and focus the editor (double-click / ⌘-click). */
  select?: boolean;
  focus?: boolean;
  /** Apply 朱砂 highlight decorations (default true). */
  highlight?: boolean;
  /** Scroll to center when not already in view (default true). */
  center?: boolean;
};

/** Per-document scroll-sync preference (default on). */
export type SyncScrollPrefs = Record<string, boolean>;

/** Anchor-based scroll sync event between preview and editor panes. */
export type ScrollSyncEvent = {
  docId: string;
  from: "preview" | "editor";
  /** Target source offset (preview→editor) or cursor/viewport offset (editor→preview). */
  sourceOffset?: number;
  /**
   * 0–100 preview scroll progress. Used as HTML fallback when data-lh anchors
   * do not cover the viewport (e.g. script-generated pages).
   */
  percent?: number;
  nonce: number;
};

export type PreviewLocateOpts = {
  /** Scroll preview to the match. Default false (caret follow must not yank preview/source). */
  scroll?: boolean;
  /** Status-bar announcement. Default false. */
  announce?: boolean;
};

export type PendingPreviewLocate = {
  offset: number;
  nonce: number;
  scroll?: boolean;
  announce?: boolean;
};

/** One-shot: expand ancestors + scroll sidebar tree to doc (tab / row dblclick). */
export type TreeRevealRequest = {
  docId: string;
  nonce: number;
};

export type LanghuanState = {
  hydrated: boolean;
  documents: Document[];
  drafts: Record<string, string>;
  trash: TrashItem[];
  /** Empty folder paths kept visible in the tree (persisted). */
  emptyFolders: string[];
  activeId: string | null;
  viewMode: ViewMode;
  theme: ThemeMode;
  tagFilters: string[];
  sidebarOpen: boolean;
  commandOpen: boolean;
  status: StatusFeedback;
  pendingReveal: PendingReveal | null;
  pendingPreviewLocate: PendingPreviewLocate | null;
  /** Sidebar tree: expand + scrollIntoView once (not on activeId change). */
  treeRevealRequest: TreeRevealRequest | null;
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
  /** Scroll percent reported by HTML preview bridge (0–100). Legacy fallback. */
  htmlScrollPercent: number;
  /** Per-doc sync scroll enabled (default true when missing). */
  syncScrollByDoc: SyncScrollPrefs;
  /** Latest scroll-sync drive event (anchor-based). */
  scrollSyncEvent: ScrollSyncEvent | null;
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

  /** Binary attachments meta (blobs in IndexedDB). */
  assets: AssetMeta[];
  /** Side annotations keyed by list (not mutating body). */
  annotations: Annotation[];
  /** HTML quiz practice state (not in document body). */
  quizDocs: QuizDoc[];
  /** Quiz review dialog. */
  quizReviewOpen: boolean;
  /** After opening a quiz doc from review list, scroll+highlight this item. */
  pendingQuizReveal: { docId: string; itemId: string } | null;
  /** MD reading prefs (font / width / focus). */
  readingPrefs: ReadingPrefs;
  /** MD focus/zen (mirrors readingPrefs.focusMode for quick toggle). */
  mdFocusMode: boolean;

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
  getSyncScrollEnabled: (docId: string) => boolean;
  setSyncScrollEnabled: (docId: string, enabled: boolean) => void;
  toggleSyncScroll: (docId: string) => void;
  publishScrollSync: (ev: Omit<ScrollSyncEvent, "nonce">) => void;
  clearScrollSyncEvent: () => void;
  setEditorCaret: (c: { line: number; col: number } | null) => void;
  getHtmlPreviewPrefs: (id: string) => HtmlDocPreviewPrefs;
  setHtmlPreviewPrefs: (id: string, patch: Partial<HtmlDocPreviewPrefs>) => void;
  bumpHtmlReload: () => void;
  setStatus: (message: string) => void;
  applyLocateResult: (result: LocateResult, opts?: { select?: boolean; focus?: boolean; highlight?: boolean; center?: boolean }) => void;
  clearPendingReveal: () => void;
  requestPreviewLocate: (offset: number, opts?: PreviewLocateOpts) => void;
  clearPendingPreviewLocate: () => void;
  /** Expand ancestors and scroll the sidebar tree to this doc once. */
  requestTreeReveal: (docId: string) => void;
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
  /** Create folder(s) under parent (default root). `name` may be nested (`a/b/c`). Returns path or null if rejected. */
  createFolder: (name: string, parentPath?: string) => string | null;
  importFiles: (
    files: { path: string; content: string }[],
    opts?: { quiet?: boolean }
  ) => number;
  /** Import binary images as AssetMeta, preserving vault-relative paths (no suggestAssetPath). */
  importAssets: (
    files: { path: string; blob: Blob; mime?: string }[],
    opts?: { quiet?: boolean }
  ) => Promise<number>;
  renameDoc: (id: string, newPath: string) => void;
  /** Rename a folder (single segment). Rewrites doc path prefixes; keeps ids. */
  renameFolder: (oldPath: string, newSegment: string) => string | null;
  /** Move a folder under newParentPath ("" = library root). Refuses self/descendant. */
  moveFolder: (oldPath: string, newParentPath: string) => string | null;
  /** Soft-delete → recycle bin. */
  deleteDoc: (id: string) => void;
  /**
   * Soft-delete every document under folderPath into trash (same as deleteDoc),
   * remove the folder and descendants from emptyFolders, and close related tabs.
   * Library root ("") is refused. Returns number of docs moved to trash.
   */
  deleteFolder: (folderPath: string) => number;
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
  setReadingPrefs: (patch: Partial<ReadingPrefs>) => void;
  setMdFocusMode: (v: boolean) => void;
  toggleMdFocusMode: () => void;
  addAnnotation: (input: AnnotationInput) => Annotation;
  updateAnnotation: (id: string, patch: { note?: string; color?: Annotation["color"] }) => void;
  removeAnnotation: (id: string) => void;
  setQuizReviewOpen: (v: boolean) => void;
  setPendingQuizReveal: (v: { docId: string; itemId: string } | null) => void;
  upsertQuizDoc: (doc: QuizDoc) => void;
  setQuizItemState: (docId: string, itemId: string, state: QuizItemState) => void;
  setQuizForce: (docId: string, force: boolean) => void;
  syncQuizForDoc: (docId: string) => QuizDoc | null;
  persistQuizStore: () => void;
  /** Persist a pasted/dropped image; returns markdown snippet to insert. */
  ingestImageFile: (
    docId: string,
    file: File | Blob,
    filename?: string
  ) => Promise<{ href: string; snippet: string; asset: AssetMeta } | null>;
  removeAsset: (id: string) => void;
  /** Open document tabs (ordered). */
  openTabs: string[];
  /** Pinned tab ids (subset of openTabs). */
  pinnedTabs: string[];
  /** Second pane doc for dual-document split (null = off). */
  secondaryId: string | null;
  /** Focused pane when secondaryId is set. */
  focusedPane: FocusedPane;
  /** Dual-doc split ratio for primary pane (0.2–0.8). */
  docSplitRatio: number;
  /** Multi-select in file tree. */
  treeSelection: string[];
  /** Whether tree shows checkboxes / batch mode. */
  batchMode: boolean;
  /** Custom keyboard shortcuts (overrides defaults). */
  customShortcuts: Partial<ShortcutMap>;
  /** Export dialog. */
  exportDialogOpen: boolean;
  /** Shortcuts prefs dialog. */
  shortcutsDialogOpen: boolean;

  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Close tabs relative to target; left/right/others/all skip pinned. */
  closeTabsInMode: (targetId: string, mode: Exclude<TabCloseMode, "self">) => void;
  togglePinTab: (id: string) => void;
  reorderTabs: (from: number, to: number) => void;
  setSecondaryId: (id: string | null) => void;
  setFocusedPane: (p: FocusedPane) => void;
  setDocSplitRatio: (r: number) => void;
  openInSplit: (id: string) => void;
  toggleDocSplit: () => void;
  setTreeSelection: (ids: string[]) => void;
  toggleTreeSelected: (id: string) => void;
  clearTreeSelection: () => void;
  setBatchMode: (v: boolean) => void;
  moveDocsToFolder: (ids: string[], folderPath: string) => number;
  batchDelete: (ids: string[]) => number;
  batchSetTags: (ids: string[], tags: string[], mode: "replace" | "add") => number;
  setCustomShortcuts: (patch: Partial<ShortcutMap>) => void;
  resetCustomShortcuts: () => void;
  setExportDialogOpen: (v: boolean) => void;
  setShortcutsDialogOpen: (v: boolean) => void;
  assetsForDoc: (docId: string) => AssetMeta[];
  /** Load library from content/ API (and one-shot IDB→content migrate / seed). */
  hydrateFromContent: () => Promise<void>;
};
