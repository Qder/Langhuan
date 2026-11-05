/**
 * 收入速记 against the real notes store.
 *
 * The pure-queue behaviour is covered in capturePlan.test.ts; this file pins the
 * binding: a capture resolves only after content/ accepted the body, rapid
 * clicks keep every block, and a failed persist is reported instead of faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

vi.mock("../storage/versions", () => ({
  pushVersion: vi.fn(async () => undefined),
  clearVersions: vi.fn(async () => undefined),
}));

vi.mock("../storage/contentApi", () => ({
  blobToBase64: vi.fn(async () => "YmFzZTY0"),
  bulkWriteLibrary: vi.fn(async (x: unknown) => x),
  deleteLibraryAsset: vi.fn(async () => undefined),
  deleteLibraryDoc: vi.fn(async () => undefined),
  ensureContentFolder: vi.fn(async () => undefined),
  fetchLibrary: vi.fn(async () => ({ documents: [], assets: [], trash: [] })),
  putLibraryAsset: vi.fn(async () => undefined),
  putLibraryDoc: vi.fn(async () => undefined),
  purgeLibraryTrash: vi.fn(async () => undefined),
  restoreLibraryTrash: vi.fn(async () => undefined),
}));

vi.mock("../storage/fsSync", () => ({
  ensureLibraryDir: vi.fn(async () => undefined),
  writeThroughDoc: vi.fn(async () => false),
}));

vi.mock("../storage/usage", () => ({
  computeStorageUsage: vi.fn(async () => ({
    usedBytes: 0,
    quotaBytes: null,
    breakdown: {},
  })),
  measureLibraryBytes: vi.fn(() => 0),
}));

vi.mock("../assets/store", () => ({
  deleteAssetBlob: vi.fn(async () => undefined),
  putAssetBlob: vi.fn(async () => undefined),
  saveAssetMetaList: vi.fn(async () => undefined),
  getAssetBlob: vi.fn(async () => null),
}));

vi.mock("../storage/contentMigration", () => ({
  stashIdbLibrary: vi.fn(),
  takeIdbLibrary: vi.fn(() => null),
}));

import { useStore } from "../store";
import { putLibraryDoc } from "../storage/contentApi";
import { resetCaptureQueues } from "./capturePlan";
import {
  captureExplainToLibrary,
  captureSnippetToLibrary,
  captureStatusMessage,
} from "./captureToLibrary";

// The store's boot chain calls purgeExpiredTrash before IDB rehydration fills
// `trash`; seed the array so that background call cannot throw in this suite.
useStore.setState({ trash: [], documents: [], assets: [] });

const SNIPPET_PATH = "读码笔记/速记.md";

/** Body as it reached content/ (last accepted write) for `path`. */
function diskBodyOf(path: string): string {
  const calls = vi.mocked(putLibraryDoc).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const doc = calls[i]![0] as { path: string; content: string };
    if (doc.path === path) return doc.content;
  }
  return "";
}

function diskSnapshot(): string {
  return diskBodyOf(SNIPPET_PATH);
}

function reset() {
  resetCaptureQueues();
  vi.mocked(putLibraryDoc).mockReset();
  vi.mocked(putLibraryDoc).mockResolvedValue(undefined as never);
  useStore.setState({
    hydrated: true,
    documents: [],
    drafts: {},
    trash: [],
    emptyFolders: [],
    activeId: null,
    status: null,
    openTabs: [],
    assets: [],
    annotations: [],
    quizDocs: [],
  });
}

beforeEach(async () => {
  // The store starts hydrateFromContent (and purgeExpiredTrash) on import; let
  // that boot sequence finish before installing the fixture, or its setState
  // calls land mid-test and wipe documents/trash.
  await new Promise((r) => setTimeout(r, 60));
  reset();
});

describe("captureSnippetToLibrary → 速记.md", () => {
  it("连点三次：磁盘正文含三段且顺序与点击一致", async () => {
    const inputs = ["A()", "B()", "C()"].map((text, i) => ({
      path: "src/a.ts",
      fromLine: i + 1,
      toLine: i + 1,
      text,
    }));

    // Fire all three without awaiting the earlier ones — the reported race.
    const results = await Promise.all(
      inputs.map((input) => captureSnippetToLibrary(input))
    );

    expect(results.every((r) => r.ok)).toBe(true);
    // One note, not three duplicates.
    const notes = useStore
      .getState()
      .documents.filter((d) => d.path === SNIPPET_PATH);
    expect(notes).toHaveLength(1);

    const disk = diskSnapshot();
    expect(disk).toContain("A()");
    expect(disk).toContain("B()");
    expect(disk).toContain("C()");
    expect(disk.indexOf("A()")).toBeLessThan(disk.indexOf("B()"));
    expect(disk.indexOf("B()")).toBeLessThan(disk.indexOf("C()"));
    // Three distinct blocks, no overwritten head block.
    expect(disk.match(/^### `/gm)).toHaveLength(3);
    // The store's live body matches what went to disk.
    expect(useStore.getState().getContent(notes[0]!.id)).toBe(disk);
  });

  it("首次写入也落到磁盘（新建笔记不靠 已是最新 短路）", async () => {
    const result = await captureSnippetToLibrary({
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "first-ever()",
    });
    expect(result.ok).toBe(true);
    expect(diskSnapshot()).toContain("first-ever()");
    expect(vi.mocked(putLibraryDoc)).toHaveBeenCalled();
  });

  it("persist 失败时回传原因且不写成功态", async () => {
    // Fail only the write that carries this block: createDoc fires its own
    // persist, so a blanket `mockRejectedValueOnce` would hit the wrong call.
    vi.mocked(putLibraryDoc).mockImplementation(async (doc) => {
      const body = (doc as { content: string }).content;
      if (body.includes("should-not-land()")) throw new Error("content/ 只读");
      return undefined as never;
    });
    const result = await captureSnippetToLibrary({
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "should-not-land()",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("content/ 只读");
    // No success phrasing anywhere in the message.
    expect(result.message).not.toContain("已收入速记");
    expect(useStore.getState().status?.message).not.toContain("已收入");
  });

  it("失败后再点一次仍能追加，之前的成功块不丢", async () => {
    const first = await captureSnippetToLibrary({
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "kept()",
    });
    expect(first.ok).toBe(true);

    vi.mocked(putLibraryDoc).mockImplementation(async (doc) => {
      const body = (doc as { content: string }).content;
      if (body.includes("failed()")) throw new Error("boom");
      return undefined as never;
    });
    const failed = await captureSnippetToLibrary({
      path: "src/a.ts",
      fromLine: 2,
      toLine: 2,
      text: "failed()",
    });
    expect(failed.ok).toBe(false);

    const third = await captureSnippetToLibrary({
      path: "src/a.ts",
      fromLine: 3,
      toLine: 3,
      text: "after()",
    });
    expect(third.ok).toBe(true);

    const disk = diskSnapshot();
    expect(disk).toContain("kept()");
    expect(disk).toContain("after()");
    expect(disk).not.toContain("failed()");
  });
});

describe("captureExplainToLibrary → 读码笔记/<工程>/<日期>-<文件>.md", () => {
  it("首次收入建一篇，含讲解要点与可点回的 ide 链", async () => {
    const result = await captureExplainToLibrary({
      question: "这个文件干什么？",
      answer: "它在 `src/A.java:12` 里做入口调度。",
      projectName: "demo",
      sourcePath: "src/A.java",
      citations: [{ path: "src/A.java", line: 12 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(/^读码笔记\/demo\/\d{4}-\d{2}-\d{2}-A\.md$/);
    expect(result.appended).toBe(false);
    expect(captureStatusMessage(result)).toContain(result.path);
    expect(captureStatusMessage(result)).not.toBe("已收入藏书阁");

    // The note is in the library (sidebar) with the answer inside.
    const note = useStore
      .getState()
      .documents.find((d) => d.id === result.docId)!;
    expect(note.path).toBe(result.path);
    expect(note.content).toContain("这个文件干什么？");
    expect(note.content).toContain("入口调度");
    // The file link carries the cited line, so the click lands where it matters.
    expect(note.content).toContain("[[ide:src/A.java:12]]");

    // …and that body really reached content/.
    const disk = diskBodyOf(result.path);
    expect(disk).toContain("入口调度");
    expect(disk).toContain("[[ide:src/A.java:12]]");
  });

  it("同一天再收入同一文件：追加一节，不建 -2.md", async () => {
    const day = new Date(2026, 10, 4, 9, 30).getTime();
    const base = {
      question: "第一问",
      answer: "第一段讲解",
      projectName: "demo",
      sourcePath: "src/A.java",
      createdAt: day,
    };
    const first = await captureExplainToLibrary(base);
    const second = await captureExplainToLibrary({
      ...base,
      question: "第二问",
      answer: "第二段讲解",
      createdAt: new Date(2026, 10, 4, 15, 5).getTime(),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.path).toBe(first.path);
    expect(second.docId).toBe(first.docId);
    expect(second.appended).toBe(true);
    expect(captureStatusMessage(second)).toContain("已追加到");
    expect(captureStatusMessage(second)).toBe(
      `已收入藏书阁 · 已追加到 ${second.path}`
    );

    const notes = useStore
      .getState()
      .documents.filter((d) => d.path.startsWith("读码笔记/demo/"));
    expect(notes).toHaveLength(1);

    const disk = diskBodyOf(first.path);
    expect(disk).toContain("第一段讲解");
    expect(disk).toContain("第二段讲解");
    expect(disk.indexOf("第一段讲解")).toBeLessThan(disk.indexOf("第二段讲解"));
    // One H1 (the note itself, from the first turn), then one H2 per later turn.
    expect(disk.match(/^# /gm)).toHaveLength(1);
    expect(disk).toContain("# 第一问");
    expect(disk).toContain("## 15:05 · 第二问");
    // The appended section is second, and carries its own jump link.
    expect(disk).toContain("- 文件：`src/A.java` · [[ide:src/A.java]]");
  });

  it("两次连点同一句讲解，也不会出现重复笔记", async () => {
    const input = {
      question: "连点",
      answer: "只该有一份",
      projectName: "demo",
      sourcePath: "src/A.java",
      createdAt: new Date(2026, 10, 4, 10, 0).getTime(),
    };
    const [a, b] = await Promise.all([
      captureExplainToLibrary(input),
      captureExplainToLibrary(input),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const notes = useStore
      .getState()
      .documents.filter((d) => d.path === (a.ok ? a.path : ""));
    expect(notes).toHaveLength(1);
    // Both turns are present — the second was appended, not lost.
    expect(diskBodyOf(a.ok ? a.path : "").match(/只该有一份/g)).toHaveLength(2);
  });
});
