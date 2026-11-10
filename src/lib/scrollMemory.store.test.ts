// @vitest-environment jsdom
/**
 * 删除 / 改名必须带上 `lh.mdScroll`：删掉的文件不该留着阅读位置，
 * 应用内改名不该让读者丢掉进度。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

vi.mock("./storage/versions", () => ({
  pushVersion: vi.fn(async () => undefined),
  clearVersions: vi.fn(async () => undefined),
}));

vi.mock("./storage/contentApi", () => ({
  blobToBase64: vi.fn(async () => "YmFzZTY0"),
  bulkWriteLibrary: vi.fn(async (x: { documents?: unknown[] }) => ({
    documents: x?.documents ?? [],
    assets: [],
    trash: [],
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
import { putLibraryDoc } from "./storage/contentApi";
import {
  MD_SCROLL_STORAGE_KEY,
  readScrollMemory,
  writeScrollMemory,
} from "./scrollMemory";

function resetStore() {
  useStore.setState({
    documents: [],
    drafts: {},
    emptyFolders: [],
    trash: [],
    activeId: null,
    openTabs: [],
    pinnedTabs: [],
    status: null,
    viewMode: "preview",
    quizDocs: [],
    quizReviewOpen: false,
    pendingQuizReveal: null,
  } as never);
}

function seedScroll(path: string, top = 400) {
  writeScrollMemory(path, top, 2000);
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe("deleteDoc forgets the scroll position", () => {
  it("drops the entry of the deleted markdown", async () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "笔记/长文.md",
      content: "# 长文\n",
      open: false,
    });
    seedScroll(doc.path);
    expect(readScrollMemory(doc.path)).not.toBeNull();

    await useStore.getState().deleteDoc(doc.id);

    expect(readScrollMemory(doc.path)).toBeNull();
    const raw = localStorage.getItem(MD_SCROLL_STORAGE_KEY);
    expect(JSON.parse(raw ?? "{}")).not.toHaveProperty(doc.path);
  });

  it("leaves other documents' positions alone", async () => {
    const victim = useStore.getState().createDoc({
      type: "md",
      path: "a.md",
      content: "# a\n",
      open: false,
    });
    const keeper = useStore.getState().createDoc({
      type: "md",
      path: "b.md",
      content: "# b\n",
      open: false,
    });
    seedScroll("a.md", 100);
    seedScroll("b.md", 200);

    await useStore.getState().deleteDoc(victim.id);

    expect(readScrollMemory("a.md")).toBeNull();
    expect(readScrollMemory("b.md")!.top).toBe(200);
    expect(useStore.getState().documents.some((d) => d.id === keeper.id)).toBe(true);
  });

  it("deleteFolder clears every doc under it", async () => {
    useStore.getState().createDoc({
      type: "md",
      path: "pack/a.md",
      content: "# a\n",
      open: false,
    });
    useStore.getState().createDoc({
      type: "md",
      path: "pack/sub/b.md",
      content: "# b\n",
      open: false,
    });
    useStore.getState().createDoc({
      type: "md",
      path: "outside.md",
      content: "# out\n",
      open: false,
    });
    seedScroll("pack/a.md", 10);
    seedScroll("pack/sub/b.md", 20);
    seedScroll("outside.md", 30);

    await useStore.getState().deleteFolder("pack");

    expect(readScrollMemory("pack/a.md")).toBeNull();
    expect(readScrollMemory("pack/sub/b.md")).toBeNull();
    expect(readScrollMemory("outside.md")!.top).toBe(30);
  });
});

describe("renameDoc carries the scroll position", () => {
  it("moves the entry from old path to new path", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "旧名.md",
      content: "# 旧名\n",
      open: false,
    });
    seedScroll("旧名.md", 800);

    useStore.getState().renameDoc(doc.id, "新名.md");

    expect(readScrollMemory("旧名.md")).toBeNull();
    const moved = readScrollMemory("新名.md");
    expect(moved?.top).toBe(800);
    expect(moved?.ratio).toBeCloseTo(0.4, 5);
  });

  it("a failed rename restores the old path's reading position along with its draft", async () => {
    const doc = useStore.getState().createDoc({ type: "md", path: "before-failure.md", content: "body", open: false });
    await useStore.getState().saveDocNow(doc.id, { force: true });
    seedScroll(doc.path, 800);
    vi.mocked(putLibraryDoc).mockRejectedValueOnce(new Error("move blocked"));
    useStore.getState().renameDoc(doc.id, "after-failure.md");
    await vi.waitFor(() => expect(useStore.getState().status?.message).toContain("move blocked"));
    expect(useStore.getState().documents.find((d) => d.id === doc.id)?.path).toBe("before-failure.md");
    expect(readScrollMemory("before-failure.md")?.top).toBe(800);
    expect(readScrollMemory("after-failure.md")).toBeNull();
    expect(useStore.getState().isDirty(doc.id)).toBe(true);
  });

  it("does not invent an entry when the doc was never read", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "cold.md",
      content: "# cold\n",
      open: false,
    });
    void doc;
    useStore.getState().renameDoc(doc.id, "cold-renamed.md");
    expect(readScrollMemory("cold-renamed.md")).toBeNull();
    expect(localStorage.getItem(MD_SCROLL_STORAGE_KEY)).toBeNull();
  });

  it("renameFolder moves each doc's entry to its new path", () => {
    useStore.getState().createDoc({
      type: "md",
      path: "pack/a.md",
      content: "# a\n",
      open: false,
    });
    useStore.getState().createDoc({
      type: "md",
      path: "pack/b.md",
      content: "# b\n",
      open: false,
    });
    seedScroll("pack/a.md", 111);
    seedScroll("pack/b.md", 222);

    useStore.getState().renameFolder("pack", "box");

    expect(readScrollMemory("pack/a.md")).toBeNull();
    expect(readScrollMemory("pack/b.md")).toBeNull();
    expect(readScrollMemory("box/a.md")!.top).toBe(111);
    expect(readScrollMemory("box/b.md")!.top).toBe(222);
  });

  it("moveDocsToFolder (which goes through renameDoc) keeps the position", () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "loose.md",
      content: "# loose\n",
      open: false,
    });
    seedScroll("loose.md", 700);

    useStore.getState().moveDocsToFolder([doc.id], "归档");

    expect(readScrollMemory("loose.md")).toBeNull();
    expect(readScrollMemory("归档/loose.md")?.top).toBe(700);
  });
});

describe("deleted doc does not resurrect on reopen", () => {
  it("a doc recreated at the same path starts from the top", async () => {
    const doc = useStore.getState().createDoc({
      type: "md",
      path: "same-path.md",
      content: "# v1\n",
      open: false,
    });
    seedScroll("same-path.md", 1500);
    await useStore.getState().deleteDoc(doc.id);
    expect(readScrollMemory("same-path.md")).toBeNull();

    // 同 path 新建（例如从回收站恢复）：不该带上旧进度。
    useStore.getState().createDoc({
      type: "md",
      path: "same-path.md",
      content: "# v2\n",
      open: false,
    });
    expect(readScrollMemory("same-path.md")).toBeNull();
  });
});

// This suite mocks library I/O; real learning migration is covered in learningPersistence.test.ts.
vi.mock("./storage/learningPersistence", () => ({ installLearningPersistence: vi.fn(), hydrateLearningState: vi.fn(async () => undefined) }));
