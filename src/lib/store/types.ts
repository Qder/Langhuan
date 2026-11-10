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
  AppMode,
} from "../types";
import type { ShortcutMap } from "../shortcuts";
import type { Annotation, AnnotationInput } from "../annotations";
import type { QuizDoc, QuizItemState } from "../quiz";
import type { ReadingPrefs } from "../readingPrefs";
import type { DocMeta, DocStatus } from "../docMeta";
import type { SavedSearch } from "../searchQuery";
import type { LearningTopic, LearningTopicCitationRef } from "../learningTopics";
import type { HtmlDocPreviewPrefs } from "../htmlPreviewPrefs";
import type { LocateResult } from "../locate/types";
import type { BridgeElementNode } from "../locate/types";
import type { JsFileIndex } from "../locate/jsIndex";
import type { StorageUsage } from "../storage/usage";
import type { BackupPayload } from "../storage/backup";
import type { StudyPaneFocus } from "../workbenchLayout";
import type { TabCloseMode } from "../tabClose";
import type { ProjectMeta } from "../project";
import type { ProjectPickedFile } from "../importProject";
import type { ImportProjectResult } from "./slices/projectsSlice";
import type { ElementPanelState } from "./slices/elementInspectSlice";
import type { CssFileIndex, RawCssHit } from "../locate/cssLocate";

/** Outcome of a durable save; `message` is the user-facing status line. */
export type SaveDocResult =
  | { ok: true; saved: boolean; path: string; message: string }
  | { ok: false; message: string };

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

/** Preview hover → source range strip (does not steal click locate). */
export type HoverReveal = {
  start: number;
  end: number;
  /** e.g. L12–L18 */
  label: string;
  nonce: number;
  /** Script-generated / no data-lh: show degrade copy, no guessed lines. */
  degrade?: boolean;
  message?: string;
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
  /** 项目（多文件站点）元数据，来自 content/<root>/.langhuan/project.json */
  projects: ProjectMeta[];
  /** 预览内联用的项目文本缓存：root → 项目内相对路径 → 内容 */
  projectTexts: Record<string, Record<string, string>>;
  /** CSS 索引（选择器 → 文件行号），来自 content/.langhuan/index/css/ */
  cssIndexes: CssFileIndex[];
  /** JS 符号索引（函数 / DOM 查询 / 事件绑定 → 文件行号），来自 content/.langhuan/index/js/ */
  jsIndexes: JsFileIndex[];
  /** 预览里点元素后的「元素检视」抽屉（HTML / 样式 / 行为）；null = 关闭 */
  elementPanel: ElementPanelState | null;
  /**
   * HTML 预览是否处于元素检视：默认关，点击归文档自己（答题、展开答案）。
   * 打开后单击即出抽屉；关着时 Alt+点击仍可检视一次。会话态，不持久化。
   */
  htmlInspectEnabled: boolean;
  setHtmlInspectEnabled: (on: boolean) => void;
  toggleHtmlInspectEnabled: () => void;
  activeId: string | null;
  viewMode: ViewMode;
  /** notes library shell vs IDE project shell */
  appMode: AppMode;
  theme: ThemeMode;
  tagFilters: string[];
  sidebarOpen: boolean;
  commandOpen: boolean;
  status: StatusFeedback;
  pendingReveal: PendingReveal | null;
  hoverReveal: HoverReveal | null;
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
  /** HTML: 点击展开的侧栏浮层（换 HTML 作业时保持；点遮罩或按钮关闭）。 */
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
  /** Lightweight groupings of existing notes and lh-cite refs (not a second document store). */
  learningTopics: LearningTopic[];
  /** Open topic on the home/topic surface; null = none. */
  activeTopicId: string | null;
  /** Quiz review dialog. */
  quizReviewOpen: boolean;
  /** Link & image health scan dialog. */
  linkHealthOpen: boolean;
  /** Library find & replace dialog. */
  findReplaceOpen: boolean;
  /** App settings dialog (theme / reading / autosave). */
  settingsDialogOpen: boolean;
  /** In-file find bar (Ctrl/Cmd+F). */
  findInFileOpen: boolean;
  /** In-memory preview-edit undo/redo stacks (not persisted). */
  previewUndoByDoc: Record<string, { undo: string[]; redo: string[] }>;
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
  setAppMode: (m: AppMode) => void;
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
  setHoverReveal: (h: HoverReveal | null) => void;
  clearHoverReveal: () => void;
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
  /** Push content-before preview edit for docId; clears redo. */
  pushPreviewUndo: (docId: string, beforeContent: string) => void;
  /** Undo last preview edit on active doc via setDraft. */
  undoPreviewEdit: () => boolean;
  /** Redo preview edit on active doc via setDraft. */
  redoPreviewEdit: () => boolean;
  clearPreviewUndo: (docId: string) => void;
  saveDoc: (id?: string) => void;
  /**
   * Same save pipeline as `saveDoc`, but resolves once the body is durable.
   * Used by 读码 captures so success is only reported after content/ accepted it.
   * `force` skips the "unchanged → 已是最新" short-circuit (needed when the note
   * was created in this same tick and still needs its first disk write).
   */
  saveDocNow: (id?: string, opts?: { force?: boolean }) => Promise<SaveDocResult>;
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
  /**
   * 把整个文件夹当成一个项目导入：保留目录结构，正文进库，css/js/图片原样落盘，
   * 并写 content/<root>/.langhuan/project.json。成功后打开入口页。
   */
  importProject: (
    name: string,
    files: ProjectPickedFile[],
    opts?: { quiet?: boolean }
  ) => Promise<ImportProjectResult>;
  /** 打开项目的入口页（index.html）。 */
  openProjectEntry: (root: string) => void;
  /** 覆盖 CSS 索引列表（hydrate 时来自 /api/library）。 */
  setCssIndexes: (list: CssFileIndex[]) => void;
  /** 覆盖 JS 符号索引列表（hydrate 时来自 /api/library）。 */
  setJsIndexes: (list: JsFileIndex[]) => void;
  /**
   * 预览里点了元素之后：把 iframe 回传的「样式命中 + 元素身份」+ 父窗口算好的源码位置，
   * 解析成 HTML / 样式 / 行为三段的数据并开抽屉。
   *
   * 索引按新鲜度取：缺失、或源码指纹与 `index.hash` 对不上才补建（异步，同一文件并发只建一次）；
   * 连点由请求闸门收敛 —— 过期的请求不会改面板、也不会写坏索引。
   */
  inspectElement: (raw: {
    /** 元素描述，如 `button#btn`；不给就按元素现算 */
    label?: string;
    /** 元素文本片段（标题下一行） */
    text?: string;
    hits: RawCssHit[];
    /** 每次点击递增（bridge 的 css 查询 nonce），抽屉拿它当重挂 key */
    nonce?: number;
    /** 真正点到的元素（样式会往上找祖先，这里始终是点击目标） */
    element?: BridgeElementNode | null;
    /** 祖先链（最多 6 层）：事件委托只能定位到父元素上的绑定 */
    ancestors?: BridgeElementNode[];
    /** 当前文档路径 / 内容：用来找项目内 .js 与解析内联 <script>，并给出 HTML 段的行号 */
    docPath?: string;
    docContent?: string;
    /** 点到的元素在源码里的区间（bridge 的 data-lh 标注）：有就是精确 */
    range?: { start: number; end: number } | null;
    /** 现有 htmlLocate 的结果（没有标注时按文本/属性推断） */
    located?: LocateResult | null;
  }) => Promise<void>;
  /** 关掉元素检视抽屉。 */
  closeInspector: () => void;
  /** 抽屉是否固定在右侧（pin 后成为布局里的一列，不遮挡预览）。 */
  elementPanelPinned: boolean;
  setElementPanelPinned: (pinned: boolean) => void;
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
  deleteDoc: (id: string) => Promise<boolean>;
  /**
   * Soft-delete every document under folderPath into trash (same as deleteDoc),
   * remove the folder and descendants from emptyFolders, and close related tabs.
   * Library root ("") is refused. Returns number of docs moved to trash.
   */
  deleteFolder: (folderPath: string) => Promise<number>;
  restoreFromTrash: (id: string) => Promise<void>;
  purgeTrashItem: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  purgeExpiredTrash: () => number;
  toggleStar: (id: string) => void;
  setDocTags: (id: string, tags: string[]) => void;
  /** Rename a tag in all persisted docs (+ drafts). Returns changed doc count. */
  renameTagAcrossLibrary: (from: string, to: string) => number;
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
  applySyncedDocuments: (docs: Document[], assets?: AssetMeta[]) => void;
  /** Replace or merge library from backup payload. */
  importLibrary: (payload: BackupPayload, mode: "merge" | "replace") => Promise<number>;
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
  reanchorDocAnnotations: (docId: string, source: string) => void;
  setQuizReviewOpen: (v: boolean) => void;
  setLinkHealthOpen: (v: boolean) => void;
  setFindReplaceOpen: (v: boolean) => void;
  setSettingsDialogOpen: (v: boolean) => void;
  setFindInFileOpen: (v: boolean) => void;
  setPendingQuizReveal: (v: { docId: string; itemId: string } | null) => void;
  upsertQuizDoc: (doc: QuizDoc) => void;
  setQuizItemState: (docId: string, itemId: string, state: QuizItemState) => void;
  setQuizForce: (docId: string, force: boolean) => void;
  syncQuizForDoc: (docId: string) => QuizDoc | null;
  persistQuizStore: () => Promise<void>;
  /** Persist a pasted/dropped image; returns markdown snippet to insert. */
  ingestImageFile: (
    docId: string,
    file: File | Blob,
    filename?: string
  ) => Promise<{ href: string; snippet: string; asset: AssetMeta } | null>;
  removeAsset: (id: string) => Promise<void>;
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
  /** Persist note+code workbench across orientation / reopen (device UI prefs). */
  studySplitEnabled: boolean;
  noteCodeSplitRatio: number;
  studyCodePath: string | null;
  studyPaneFocus: StudyPaneFocus;
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
  setStudySplitEnabled: (v: boolean) => void;
  setNoteCodeSplitRatio: (r: number) => void;
  setStudyCodePath: (path: string | null) => void;
  setStudyPaneFocus: (p: StudyPaneFocus) => void;
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
  createLearningTopic: (input: { title: string; description?: string }) => LearningTopic;
  renameLearningTopic: (id: string, title: string) => void;
  setLearningTopicDescription: (id: string, description: string) => void;
  deleteLearningTopic: (id: string) => void;
  addLearningTopicNote: (id: string, noteId: string) => void;
  removeLearningTopicNote: (id: string, noteId: string) => void;
  addLearningTopicCitation: (
    id: string,
    ref: Omit<LearningTopicCitationRef, "id"> & { id?: string },
  ) => void;
  removeLearningTopicCitation: (id: string, citationId: string) => void;
  setActiveTopicId: (id: string | null) => void;
  /** Load library from content/ API (and one-shot IDB→content migrate / seed). */
  hydrateFromContent: () => Promise<void>;
};
