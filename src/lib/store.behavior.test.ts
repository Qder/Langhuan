/**
 * Behavior + shape snapshots for useStore.
 * Lock current external shape/actions before/while splitting into slices.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

const pushVersion = vi.fn(async (...args: unknown[]) => {
  void args;
});
const clearVersions = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("./storage/versions", () => ({
  pushVersion: (...args: unknown[]) => pushVersion(...args),
  clearVersions: (...args: unknown[]) => clearVersions(...args),
}));

vi.mock("./storage/contentApi", () => ({
  blobToBase64: vi.fn(async () => "YmFzZTY0"),
  bulkWriteLibrary: vi.fn(async (x: {
    documents?: unknown[];
    assets?: unknown[];
    trash?: unknown[];
  }) => ({
    documents: x?.documents ?? [],
    assets: x?.assets ?? [],
    trash: x?.trash ?? [],
  })),
  deleteLibraryAsset: vi.fn(async () => undefined),
  deleteLibraryDoc: vi.fn(async () => undefined),
  ensureContentFolder: vi.fn(async () => undefined),
  fetchLibrary: vi.fn(async () => ({ documents: [], assets: [], trash: [] })),
  putLibraryAsset: vi.fn(async () => undefined),
  putLibraryDoc: vi.fn(async () => undefined),
  purgeLibraryTrash: vi.fn(async () => undefined),
  restoreLibraryTrash: vi.fn(async () => {
    throw new Error("force fallback persist");
  }),
}));

vi.mock("./storage/fsSync", () => ({
  ensureLibraryDir: vi.fn(async () => undefined),
  writeThroughDoc: vi.fn(async () => false),
}));

vi.mock("./storage/usage", () => ({
  computeStorageUsage: vi.fn(async () => ({
    usedBytes: 12,
    quotaBytes: null,
    breakdown: {},
  })),
  measureLibraryBytes: vi.fn(() => 12),
}));

vi.mock("./assets/store", () => ({
  deleteAssetBlob: vi.fn(async () => undefined),
  putAssetBlob: vi.fn(async () => undefined),
  saveAssetMetaList: vi.fn(async () => undefined),
  getAssetBlob: vi.fn(async () => null),
}));

vi.mock("./storage/contentMigration", () => ({
  stashIdbLibrary: vi.fn(),
  takeIdbLibrary: vi.fn(() => null),
}));

import { useStore } from "./store";
import type { LocateResult } from "./locate/types";
import { bulkWriteLibrary, putLibraryDoc } from "./storage/contentApi";

/** Sorted keys that must remain on useStore.getState() after any slice extract. */
const EXPECTED_STATE_KEYS = [
  "activeId",
  "addAnnotation",
  "addSavedSearch",
  "annotations",
  "anyDirty",
  "appMode",
  "applyLocateResult",
  "applySyncedDocuments",
  "assets",
  "assetsForDoc",
  "autosaveEnabled",
  "backupDialogOpen",
  "batchDelete",
  "batchMode",
  "batchSetTags",
  "bumpHtmlReload",
  "clearHoverReveal",
  "clearPendingPreviewLocate",
  "clearPendingReveal",
  "clearPreviewUndo",
  "clearScrollSyncEvent",
  "clearTagFilters",
  "clearTreeSelection",
  "clipUrlDialogOpen",
  "closeInspector",
  "closeTab",
  "closeTabsInMode",
  "commandOpen",
  "createDoc",
  "createFolder",
  "createFromTemplate",
  "cssIndexes",
  "customShortcuts",
  "deleteDoc",
  "deleteFolder",
  "discardDraft",
  "docSplitRatio",
  "documents",
  "drafts",
  "editorCaret",
  "elementPanel",
  "elementPanelPinned",
  "emptyFolders",
  "emptyTrash",
  "exportDialogOpen",
  "exportPayload",
  "findInFileOpen",
  "findReplaceOpen",
  "focusedPane",
  "fsBoundName",
  "fsLastSyncAt",
  "fsSyncDialogOpen",
  "getActive",
  "getContent",
  "getHtmlPreviewPrefs",
  "getSyncScrollEnabled",
  "graphDialogOpen",
  "hoverReveal",
  "htmlImmersive",
  "htmlInspectEnabled",
  "htmlPreviewPrefs",
  "htmlReloadToken",
  "htmlScrollPercent",
  "htmlSidebarPeek",
  "hydrateFromContent",
  "hydrated",
  "importAssets",
  "importFiles",
  "importLibrary",
  "importProject",
  "ingestImageFile",
  "inspectElement",
  "isDirty",
  "jsIndexes",
  "lastBackupAt",
  "linkHealthOpen",
  "mdFocusMode",
  "moveDocsToFolder",
  "moveFolder",
  "openDailyNote",
  "openDoc",
  "openHome",
  "openInSplit",
  "openProjectEntry",
  "openTab",
  "openTabs",
  "outlineRailOpen",
  "outlineWidth",
  "pendingNav",
  "pendingPreviewLocate",
  "pendingQuizReveal",
  "pendingReveal",
  "persistQuizStore",
  "pinnedTabs",
  "previewUndoByDoc",
  "projectTexts",
  "projects",
  "propsDialogOpen",
  "publishScrollSync",
  "purgeExpiredTrash",
  "purgeTrashItem",
  "pushPreviewUndo",
  "quizDocs",
  "quizReviewOpen",
  "readingPrefs",
  "reanchorDocAnnotations",
  "redoPreviewEdit",
  "refreshStorageUsage",
  "removeAnnotation",
  "removeAsset",
  "removeSavedSearch",
  "renameDoc",
  "renameFolder",
  "renameTagAcrossLibrary",
  "reorderTabs",
  "requestOpenDoc",
  "requestOpenHome",
  "requestPreviewLocate",
  "requestTreeReveal",
  "resetCustomShortcuts",
  "resetSeed",
  "resolvePendingNav",
  "restoreFromTrash",
  "saveDoc",
  "saveDocNow",
  "savedSearches",
  "scrollSyncEvent",
  "secondaryId",
  "setAppMode",
  "setAutosaveEnabled",
  "setBackupDialogOpen",
  "setBatchMode",
  "setClipUrlDialogOpen",
  "setCommandOpen",
  "setCssIndexes",
  "setCustomShortcuts",
  "setDocMeta",
  "setDocSplitRatio",
  "setDocTags",
  "setDraft",
  "setEditorCaret",
  "setElementPanelPinned",
  "setExportDialogOpen",
  "setFindInFileOpen",
  "setFindReplaceOpen",
  "setFocusedPane",
  "setFsBoundName",
  "setFsLastSyncAt",
  "setFsSyncDialogOpen",
  "setGraphDialogOpen",
  "setHoverReveal",
  "setHtmlImmersive",
  "setHtmlInspectEnabled",
  "setHtmlPreviewPrefs",
  "setHtmlScrollPercent",
  "setHtmlSidebarPeek",
  "setHydrated",
  "setJsIndexes",
  "setLastBackupAt",
  "setLinkHealthOpen",
  "setMdFocusMode",
  "setOutlineRailOpen",
  "setOutlineWidth",
  "setPendingQuizReveal",
  "setPropsDialogOpen",
  "setQuizForce",
  "setQuizItemState",
  "setQuizReviewOpen",
  "setReadingPrefs",
  "setSavedSearches",
  "setSecondaryId",
  "setSettingsDialogOpen",
  "setShortcutsDialogOpen",
  "setSidebarOpen",
  "setSidebarPanel",
  "setSidebarWidth",
  "setSplitRatio",
  "setSplitSourceFirst",
  "setStatus",
  "setStatusFilter",
  "setSyncScrollEnabled",
  "setTagFilters",
  "setTemplateDialogOpen",
  "setTheme",
  "setTreeSelection",
  "setVersionDialogOpen",
  "setViewMode",
  "settingsDialogOpen",
  "shortcutsDialogOpen",
  "sidebarOpen",
  "sidebarPanel",
  "sidebarWidth",
  "splitRatio",
  "splitSourceFirst",
  "status",
  "statusFilter",
  "storageBytes",
  "storageUsage",
  "syncQuizForDoc",
  "syncScrollByDoc",
  "tagFilters",
  "templateDialogOpen",
  "theme",
  "toggleDocSplit",
  "toggleHtmlImmersive",
  "toggleHtmlInspectEnabled",
  "toggleMdFocusMode",
  "toggleOutlineRail",
  "togglePinTab",
  "toggleSplitSourceFirst",
  "toggleStar",
  "toggleSyncScroll",
  "toggleTagFilter",
  "toggleTheme",
  "toggleTreeSelected",
  "trash",
  "treeRevealRequest",
  "treeSelection",
  "undoPreviewEdit",
  "updateAnnotation",
  "upsertQuizDoc",
  "versionDialogOpen",
  "viewMode",
] as const;

function resetLibraryState() {
  useStore.setState({
    hydrated: true,
    documents: [],
    drafts: {},
    trash: [],
    emptyFolders: [],
    activeId: null,
    viewMode: "preview",
    theme: "xuan",
    tagFilters: [],
    sidebarOpen: false,
    commandOpen: false,
    status: null,
    pendingReveal: null,
    hoverReveal: null,
    pendingPreviewLocate: null,
    treeRevealRequest: null,
    pendingNav: null,
    splitRatio: 0.5,
    splitSourceFirst: true,
    sidebarWidth: 280,
    outlineWidth: 240,
    outlineRailOpen: true,
    sidebarPanel: "docs",
    htmlImmersive: false,
    htmlInspectEnabled: false,
    htmlSidebarPeek: false,
    htmlScrollPercent: 0,
    syncScrollByDoc: {},
    scrollSyncEvent: null,
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
    assets: [],
    annotations: [],
    quizDocs: [],
    quizReviewOpen: false,
    linkHealthOpen: false,
    findReplaceOpen: false,
    settingsDialogOpen: false,
    findInFileOpen: false,
    previewUndoByDoc: {},
    pendingQuizReveal: null,
    openTabs: [],
    pinnedTabs: [],
    secondaryId: null,
    focusedPane: "primary",
    docSplitRatio: 0.5,
    treeSelection: [],
    batchMode: false,
    customShortcuts: {},
    exportDialogOpen: false,
    shortcutsDialogOpen: false,
    mdFocusMode: false,
  });
  pushVersion.mockClear();
  clearVersions.mockClear();
}

describe("store shape snapshot", () => {
  it("exposes the full sorted key set (fields + actions)", () => {
    const keys = Object.keys(useStore.getState()).sort();
    expect(keys).toEqual([...EXPECTED_STATE_KEYS]);
  });

  it("exposes actions as functions with stable names", () => {
    const state = useStore.getState() as Record<string, unknown>;
    const actionNames = Object.keys(state)
      .filter((k) => typeof state[k] === "function")
      .sort();
    expect(actionNames).toMatchInlineSnapshot(`
      [
        "addAnnotation",
        "addSavedSearch",
        "anyDirty",
        "applyLocateResult",
        "applySyncedDocuments",
        "assetsForDoc",
        "batchDelete",
        "batchSetTags",
        "bumpHtmlReload",
        "clearHoverReveal",
        "clearPendingPreviewLocate",
        "clearPendingReveal",
        "clearPreviewUndo",
        "clearScrollSyncEvent",
        "clearTagFilters",
        "clearTreeSelection",
        "closeInspector",
        "closeTab",
        "closeTabsInMode",
        "createDoc",
        "createFolder",
        "createFromTemplate",
        "deleteDoc",
        "deleteFolder",
        "discardDraft",
        "emptyTrash",
        "exportPayload",
        "getActive",
        "getContent",
        "getHtmlPreviewPrefs",
        "getSyncScrollEnabled",
        "hydrateFromContent",
        "importAssets",
        "importFiles",
        "importLibrary",
        "importProject",
        "ingestImageFile",
        "inspectElement",
        "isDirty",
        "moveDocsToFolder",
        "moveFolder",
        "openDailyNote",
        "openDoc",
        "openHome",
        "openInSplit",
        "openProjectEntry",
        "openTab",
        "persistQuizStore",
        "publishScrollSync",
        "purgeExpiredTrash",
        "purgeTrashItem",
        "pushPreviewUndo",
        "reanchorDocAnnotations",
        "redoPreviewEdit",
        "refreshStorageUsage",
        "removeAnnotation",
        "removeAsset",
        "removeSavedSearch",
        "renameDoc",
        "renameFolder",
        "renameTagAcrossLibrary",
        "reorderTabs",
        "requestOpenDoc",
        "requestOpenHome",
        "requestPreviewLocate",
        "requestTreeReveal",
        "resetCustomShortcuts",
        "resetSeed",
        "resolvePendingNav",
        "restoreFromTrash",
        "saveDoc",
        "saveDocNow",
        "setAppMode",
        "setAutosaveEnabled",
        "setBackupDialogOpen",
        "setBatchMode",
        "setClipUrlDialogOpen",
        "setCommandOpen",
        "setCssIndexes",
        "setCustomShortcuts",
        "setDocMeta",
        "setDocSplitRatio",
        "setDocTags",
        "setDraft",
        "setEditorCaret",
        "setElementPanelPinned",
        "setExportDialogOpen",
        "setFindInFileOpen",
        "setFindReplaceOpen",
        "setFocusedPane",
        "setFsBoundName",
        "setFsLastSyncAt",
        "setFsSyncDialogOpen",
        "setGraphDialogOpen",
        "setHoverReveal",
        "setHtmlImmersive",
        "setHtmlInspectEnabled",
        "setHtmlPreviewPrefs",
        "setHtmlScrollPercent",
        "setHtmlSidebarPeek",
        "setHydrated",
        "setJsIndexes",
        "setLastBackupAt",
        "setLinkHealthOpen",
        "setMdFocusMode",
        "setOutlineRailOpen",
        "setOutlineWidth",
        "setPendingQuizReveal",
        "setPropsDialogOpen",
        "setQuizForce",
        "setQuizItemState",
        "setQuizReviewOpen",
        "setReadingPrefs",
        "setSavedSearches",
        "setSecondaryId",
        "setSettingsDialogOpen",
        "setShortcutsDialogOpen",
        "setSidebarOpen",
        "setSidebarPanel",
        "setSidebarWidth",
        "setSplitRatio",
        "setSplitSourceFirst",
        "setStatus",
        "setStatusFilter",
        "setSyncScrollEnabled",
        "setTagFilters",
        "setTemplateDialogOpen",
        "setTheme",
        "setTreeSelection",
        "setVersionDialogOpen",
        "setViewMode",
        "storageBytes",
        "syncQuizForDoc",
        "toggleDocSplit",
        "toggleHtmlImmersive",
        "toggleHtmlInspectEnabled",
        "toggleMdFocusMode",
        "toggleOutlineRail",
        "togglePinTab",
        "toggleSplitSourceFirst",
        "toggleStar",
        "toggleSyncScroll",
        "toggleTagFilter",
        "toggleTheme",
        "toggleTreeSelected",
        "undoPreviewEdit",
        "updateAnnotation",
        "upsertQuizDoc",
      ]
    `);
  });
});

describe("store behavior snapshots", () => {
  beforeEach(() => {
    resetLibraryState();
  });

  it("createDoc / renameDoc / moveDocsToFolder / deleteDoc", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "notes/a.md",
      content: "# A\n",
      open: true,
    });
    expect(useStore.getState().documents.map((d) => d.path)).toEqual(["notes/a.md"]);
    expect(useStore.getState().activeId).toBe(doc.id);
    expect(useStore.getState().openTabs).toContain(doc.id);
    expect(useStore.getState().viewMode).toBe("source");

    useStore.getState().renameDoc(doc.id, "notes/b.md");
    expect(useStore.getState().documents[0]?.path).toBe("notes/b.md");

    const n = useStore.getState().moveDocsToFolder([doc.id], "archive");
    expect(n).toBe(1);
    expect(useStore.getState().documents[0]?.path).toBe("archive/b.md");

    useStore.getState().deleteDoc(doc.id);
    expect(useStore.getState().documents).toHaveLength(0);
    expect(useStore.getState().trash).toHaveLength(1);
    expect(useStore.getState().trash[0]?.doc.path).toBe("archive/b.md");
  });

  it("createFolder / deleteFolder soft-deletes contained docs", () => {
    const folder = useStore.getState().createFolder("proj", "");
    expect(folder).toBe("proj");
    expect(useStore.getState().emptyFolders).toContain("proj");

    const d = useStore.getState().createDoc({
      type: "md",
      path: "proj/x.md",
      content: "x",
      open: false,
    });
    const n = useStore.getState().deleteFolder("proj");
    expect(n).toBe(1);
    expect(useStore.getState().documents.find((x) => x.id === d.id)).toBeUndefined();
    expect(useStore.getState().trash.some((t) => t.doc.id === d.id)).toBe(true);
    expect(useStore.getState().emptyFolders.includes("proj")).toBe(false);
  });

  it("createFolder accepts nested paths and only fills missing layers", () => {
    const full = useStore.getState().createFolder("a/b/c", "");
    expect(full).toBe("a/b/c");
    const empties = useStore.getState().emptyFolders;
    expect(empties).toEqual(expect.arrayContaining(["a", "a/b", "a/b/c"]));

    // existing middle layer: only add deeper missing
    useStore.getState().createDoc({
      type: "md",
      path: "algo/readme.md",
      content: "x",
      open: false,
    });
    // prune may drop "a" etc still; create under algo
    const nested = useStore.getState().createFolder("图论/最短路", "algo");
    expect(nested).toBe("algo/图论/最短路");
    const after = useStore.getState().emptyFolders;
    expect(after).toEqual(expect.arrayContaining(["algo/图论", "algo/图论/最短路"]));
    // algo itself has a doc so should not stay in emptyFolders
    expect(after.includes("algo")).toBe(false);

    const again = useStore.getState().createFolder("图论/最短路", "algo");
    expect(again).toBe("algo/图论/最短路");
    expect(useStore.getState().status?.message).toMatch(/已存在/);
  });


  it("renameFolder / moveFolder rewrite docs and emptyFolders", () => {
    useStore.getState().createFolder("src/util", "");
    const d = useStore.getState().createDoc({
      type: "md",
      path: "src/util/a.md",
      content: "hello",
      open: true,
    });
    // util may be pruned from emptyFolders because it has a doc; keep a nested empty
    useStore.getState().createFolder("空", "src/util");

    const renamed = useStore.getState().renameFolder("src", "source");
    expect(renamed).toBe("source");
    expect(useStore.getState().documents.find((x) => x.id === d.id)?.path).toBe(
      "source/util/a.md"
    );
    expect(useStore.getState().emptyFolders).toEqual(
      expect.arrayContaining(["source/util/空"])
    );
    expect(useStore.getState().activeId).toBe(d.id);
    expect(useStore.getState().getActive()?.path).toBe("source/util/a.md");

    const moved = useStore.getState().moveFolder("source/util", "archive");
    expect(moved).toBe("archive/util");
    expect(useStore.getState().documents.find((x) => x.id === d.id)?.path).toBe(
      "archive/util/a.md"
    );
    expect(useStore.getState().emptyFolders).toEqual(
      expect.arrayContaining(["archive/util/空"])
    );

    expect(useStore.getState().moveFolder("archive/util", "archive/util/x")).toBeNull();
    expect(useStore.getState().status?.message).toMatch(/自身/);
  });


  it("preview undo / redo via setDraft; empty undo is no-op; save keeps stacks", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "notes/undo.md",
      content: "v0\n",
      open: true,
    });
    const id = doc.id;
    useStore.getState().pushPreviewUndo(id, "v0\n");
    useStore.getState().setDraft(id, "v1\n");
    useStore.getState().pushPreviewUndo(id, "v1\n");
    useStore.getState().setDraft(id, "v2\n");
    expect(useStore.getState().getContent(id)).toBe("v2\n");

    expect(useStore.getState().undoPreviewEdit()).toBe(true);
    expect(useStore.getState().getContent(id)).toBe("v1\n");
    expect(useStore.getState().isDirty(id)).toBe(true);
    expect(useStore.getState().status?.message).toBe("已撤销预览编辑");

    expect(useStore.getState().undoPreviewEdit()).toBe(true);
    expect(useStore.getState().getContent(id)).toBe("v0\n");

    expect(useStore.getState().redoPreviewEdit()).toBe(true);
    expect(useStore.getState().getContent(id)).toBe("v1\n");
    expect(useStore.getState().status?.message).toBe("已重做预览编辑");

    // Policy: save does not clear stacks; undo only setDraft (never auto-save).
    useStore.getState().saveDoc(id);
    expect(useStore.getState().undoPreviewEdit()).toBe(true);
    expect(useStore.getState().getContent(id)).toBe("v0\n");
    expect(useStore.getState().isDirty(id)).toBe(true);

    useStore.getState().clearPreviewUndo(id);
    expect(useStore.getState().undoPreviewEdit()).toBe(false);
    expect(useStore.getState().getContent(id)).toBe("v0\n");
  });

  it("draft / dirty / saveDoc / discardDraft + version push on save", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "d.md",
      content: "orig",
      open: true,
    });
    expect(useStore.getState().isDirty(doc.id)).toBe(false);

    useStore.getState().setDraft(doc.id, "changed");
    expect(useStore.getState().isDirty(doc.id)).toBe(true);
    expect(useStore.getState().getContent(doc.id)).toBe("changed");
    expect(useStore.getState().anyDirty()).toBe(true);

    useStore.getState().saveDoc(doc.id);
    expect(useStore.getState().isDirty(doc.id)).toBe(false);
    expect(useStore.getState().documents[0]?.content).toBe("changed");
    expect(pushVersion).toHaveBeenCalled();
    const first = pushVersion.mock.calls[0]?.[0] as {
      docId: string;
      content: string;
      path: string;
    };
    expect(first).toMatchObject({
      docId: doc.id,
      content: "orig",
      path: "d.md",
    });

    useStore.getState().setDraft(doc.id, "again");
    useStore.getState().discardDraft(doc.id);
    expect(useStore.getState().isDirty(doc.id)).toBe(false);
    expect(useStore.getState().getContent(doc.id)).toBe("changed");
  });

  it("saveDoc noop: same body skips version/updatedAt and says 已是最新", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "noop.md",
      content: "same\r\nline",
      open: true,
    });
    const before = useStore.getState().documents.find((d) => d.id === doc.id)!;
    const updatedAt = before.updatedAt;
    const docsRef = useStore.getState().documents;
    pushVersion.mockClear();

    // Draft equals saved after newline normalize
    useStore.getState().setDraft(doc.id, "same\nline");
    useStore.getState().saveDoc(doc.id);

    expect(pushVersion).not.toHaveBeenCalled();
    expect(useStore.getState().documents).toBe(docsRef);
    const after = useStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(after.updatedAt).toBe(updatedAt);
    expect(useStore.getState().isDirty(doc.id)).toBe(false);
    expect(useStore.getState().status?.message).toContain("已是最新");

    // Second ⌘S with no draft
    pushVersion.mockClear();
    const docsRef2 = useStore.getState().documents;
    useStore.getState().saveDoc(doc.id);
    expect(pushVersion).not.toHaveBeenCalled();
    expect(useStore.getState().documents).toBe(docsRef2);
    expect(useStore.getState().status?.message).toContain("已是最新");
  });

  it("tags and star", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "t.md",
      content: "---\ntags: []\n---\n\nHi\n",
      open: false,
    });
    useStore.getState().setDocTags(doc.id, ["甲", "乙"]);
    expect(useStore.getState().getContent(doc.id)).toContain("甲");
    useStore.getState().toggleStar(doc.id);
    expect(useStore.getState().documents[0]?.starred).toBe(true);
  });

  it("viewMode and applyLocateResult", () => {
    useStore.getState().setViewMode("preview");
    expect(useStore.getState().viewMode).toBe("preview");

    const hit: LocateResult = {
      precision: "exact",
      start: 2,
      end: 5,
      message: "已定位",
    };
    useStore.getState().applyLocateResult(hit);
    expect(useStore.getState().pendingReveal).toMatchObject({
      start: 2,
      end: 5,
      select: false,
    });
    expect(useStore.getState().viewMode).toBe("preview");
    expect(useStore.getState().status?.message).toContain("记住");

    useStore.getState().applyLocateResult(hit, { select: true, focus: true });
    expect(useStore.getState().viewMode).toBe("split");
    expect(useStore.getState().pendingReveal?.select).toBe(true);
    expect(useStore.getState().htmlImmersive).toBe(false);
  });

  it("trash restore and purge", async () => {
    const doc = useStore.getState().createDoc({
      type: "html",
      path: "p.html",
      content: "<p>x</p>",
      open: false,
    });
    useStore.getState().deleteDoc(doc.id);
    expect(useStore.getState().trash).toHaveLength(1);

    useStore.getState().restoreFromTrash(doc.id);
    expect(useStore.getState().trash).toHaveLength(0);
    expect(useStore.getState().documents.some((d) => d.id === doc.id)).toBe(true);

    useStore.getState().deleteDoc(doc.id);
    useStore.getState().purgeTrashItem(doc.id);
    expect(useStore.getState().trash).toHaveLength(0);
    expect(clearVersions).toHaveBeenCalledWith(doc.id);
  });

  it("saved searches and UI prefs", () => {
    useStore.getState().addSavedSearch("验收", "tag:验收");
    expect(useStore.getState().savedSearches).toHaveLength(1);
    const sid = useStore.getState().savedSearches[0]!.id;
    useStore.getState().removeSavedSearch(sid);
    expect(useStore.getState().savedSearches).toHaveLength(0);

    useStore.getState().setSidebarWidth(300);
    expect(useStore.getState().sidebarWidth).toBe(300);
    useStore.getState().setTheme("bamboo");
    expect(useStore.getState().theme).toBe("bamboo");
    useStore.getState().setAutosaveEnabled(false);
    expect(useStore.getState().autosaveEnabled).toBe(false);
    useStore.getState().toggleTagFilter("验收");
    expect(useStore.getState().tagFilters).toEqual(["验收"]);
  });

  it("exportPayload / importLibrary merge", () => {
    useStore.getState().createDoc({
      type: "md",
      path: "keep.md",
      content: "k",
      open: false,
    });
    const payload = useStore.getState().exportPayload();
    expect(payload.documents).toHaveLength(1);

    const n = useStore.getState().importLibrary(
      {
        documents: [
          {
            id: "incoming",
            path: "new.md",
            type: "md",
            content: "n",
            starred: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        trash: [],
      },
      "merge"
    );
    expect(n).toBe(1);
    expect(useStore.getState().documents.map((d) => d.path).sort()).toEqual([
      "keep.md",
      "new.md",
    ]);
  });

  it("openTab / closeTab and requestOpenDoc dirty gate", () => {
    const a = useStore.getState().createDoc({
      type: "md",
      path: "a.md",
      content: "a",
      open: true,
    });
    const b = useStore.getState().createDoc({
      type: "md",
      path: "b.md",
      content: "b",
      open: false,
    });
    useStore.getState().openDoc(a.id);
    useStore.getState().setDraft(a.id, "dirty-a");
    useStore.getState().requestOpenDoc(b.id);
    expect(useStore.getState().pendingNav).toEqual({ kind: "doc", id: b.id });
    expect(useStore.getState().activeId).toBe(a.id);

    useStore.getState().resolvePendingNav("discard");
    expect(useStore.getState().activeId).toBe(b.id);
    expect(useStore.getState().isDirty(a.id)).toBe(false);

    useStore.getState().closeTab(b.id);
    expect(useStore.getState().openTabs.includes(b.id)).toBe(false);
  });

  it("HTML 换文档不关侧栏；打开 Markdown 才关", () => {
    const a = useStore.getState().createDoc({
      type: "html",
      path: "作业/一阶.html",
      content: "<p>a</p>",
      open: true,
    });
    const b = useStore.getState().createDoc({
      type: "html",
      path: "作业/图论.html",
      content: "<p>b</p>",
      open: false,
    });
    const md = useStore.getState().createDoc({
      type: "md",
      path: "作业/笔记.md",
      content: "md",
      open: false,
    });
    useStore.getState().setSidebarOpen(true);
    useStore.getState().setHtmlSidebarPeek(true);
    useStore.getState().openDoc(b.id);
    expect(useStore.getState().activeId).toBe(b.id);
    expect(useStore.getState().sidebarOpen).toBe(true);
    expect(useStore.getState().htmlSidebarPeek).toBe(true);

    useStore.getState().openDoc(md.id);
    expect(useStore.getState().activeId).toBe(md.id);
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(useStore.getState().htmlSidebarPeek).toBe(false);

    useStore.getState().setSidebarOpen(true);
    useStore.getState().openDoc(a.id);
    expect(useStore.getState().sidebarOpen).toBe(true);
    expect(useStore.getState().htmlSidebarPeek).toBe(false);
  });

  it("surfaces putLibraryDoc / bulkWriteLibrary reject in status", async () => {
    const put = vi.mocked(putLibraryDoc);
    const bulk = vi.mocked(bulkWriteLibrary);
    put.mockRejectedValueOnce(new Error("disk full"));

    useStore.getState().createDoc({
      type: "md",
      path: "fail-put.md",
      content: "x",
      open: false,
    });
    await vi.waitFor(() => {
      expect(useStore.getState().status?.message || "").toMatch(/失败/);
    });
    expect(useStore.getState().status?.message).toContain("disk full");

    put.mockResolvedValue(undefined as never);
    useStore.setState({ status: null });
    bulk.mockRejectedValueOnce(new Error("bulk boom"));
    useStore.getState().importLibrary(
      {
        documents: [
          {
            id: "incoming-fail",
            path: "fail-bulk.md",
            type: "md",
            content: "z",
            starred: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        trash: [],
      },
      "replace"
    );
    await vi.waitFor(() => {
      expect(useStore.getState().status?.message || "").toContain("bulk boom");
    });

    bulk.mockImplementation(async (x) => ({
      documents: x?.documents ?? [],
      assets: x?.assets ?? [],
      trash: x?.trash ?? [],
      projects: [],
      projectTexts: {},
      cssIndexes: [],
      jsIndexes: [],
      ok: true,
      source: "content" as const,
    }));
  });

  it("saveDocNow waits for putLibraryDoc and reports failure honestly", async () => {
    const put = vi.mocked(putLibraryDoc);
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "now.md",
      content: "body",
      open: false,
    });
    await vi.waitFor(() => expect(put).toHaveBeenCalled());

    // Success: the promise resolves only after the write settles.
    put.mockResolvedValue(undefined as never);
    useStore.getState().setDraft(doc.id, "body v2");
    const ok = await useStore.getState().saveDocNow(doc.id);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.saved).toBe(true);
    expect(ok.path).toBe("now.md");
    expect(useStore.getState().isDirty(doc.id)).toBe(false);

    // Failure: no success status, and the draft stays pending for a retry.
    put.mockRejectedValueOnce(new Error("readonly content/"));
    useStore.getState().setDraft(doc.id, "body v3");
    const failed = await useStore.getState().saveDocNow(doc.id);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.message).toContain("readonly content/");
    expect(useStore.getState().status?.message).not.toContain("已保存");
    expect(useStore.getState().isDirty(doc.id)).toBe(true);
    expect(useStore.getState().getContent(doc.id)).toBe("body v3");
  });

  it("saveDocNow keeps 已是最新 for an unchanged body", async () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "latest.md",
      content: "same\nline",
      open: false,
    });
    await vi.waitFor(() => expect(vi.mocked(putLibraryDoc)).toHaveBeenCalled());
    vi.mocked(putLibraryDoc).mockClear();

    useStore.getState().setDraft(doc.id, "same\r\nline");
    const same = await useStore.getState().saveDocNow(doc.id);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.saved).toBe(false);
    expect(same.message).toContain("已是最新");
    expect(vi.mocked(putLibraryDoc)).not.toHaveBeenCalled();
  });
});
