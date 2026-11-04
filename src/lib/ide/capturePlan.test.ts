/**
 * 读码 → 藏书阁 写入计划 (B1 / B2).
 *
 * A tiny in-memory writer stands in for the notes store: these tests care about
 * path choice, dedupe-by-suffix reporting, truncation notes, append order, and
 * the read-modify-write queue — not about idb persistence (covered elsewhere).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureExplain,
  captureSnippet,
  captureStatusMessage,
  resetCaptureQueues,
  type CaptureWriteOutcome,
  type NoteWriter,
} from "./capturePlan";
import { SNIPPET_NOTE_HEADER } from "./captureNote";

type FakeDoc = { id: string; path: string; content: string };

type WriterOpts = {
  /** Resolve the durable write only when the test says so. */
  deferred?: boolean;
};

function makeWriter(opts: WriterOpts = {}) {
  const docs: FakeDoc[] = [];
  const drafts = new Map<string, string>();
  let seq = 0;
  /** Body confirmed on "disk" — the source of truth for assertions. */
  const onDisk = new Map<string, string>();
  const pending: Array<() => void> = [];
  let failNext = 0;
  let failWith = "disk full";

  const writer: NoteWriter = {
    findByPath: (path) => docs.find((d) => d.path === path),
    contentOf: (docId) =>
      drafts.get(docId) ?? onDisk.get(docId) ?? docs.find((d) => d.id === docId)!.content,
    create: ({ path, content }) => {
      // Mirror the store rule: same path → `-2`, `-3`… suffix.
      let finalPath = path;
      if (docs.some((d) => d.path === finalPath)) {
        const m = path.match(/^(.*?)(\.[^.]+)?$/);
        const base = m?.[1] ?? path;
        const ext = m?.[2] ?? "";
        let i = 2;
        while (docs.some((d) => d.path === `${base}-${i}${ext}`)) i += 1;
        finalPath = `${base}-${i}${ext}`;
      }
      const doc = { id: `d${++seq}`, path: finalPath, content };
      docs.push(doc);
      drafts.set(doc.id, content);
      return doc;
    },
    write: (docId, content) => {
      // Decide failure at call time, so a test can arm the next *call* even
      // while an earlier write is still in flight.
      const fails = failNext > 0;
      if (fails) {
        failNext -= 1;
        const message = failWith;
        const fail = (): CaptureWriteOutcome => ({ ok: false, message });
        if (!opts.deferred) return Promise.resolve(fail());
        return new Promise<CaptureWriteOutcome>((resolve) => {
          pending.push(() => resolve(fail()));
        });
      }
      const commit = (): CaptureWriteOutcome => {
        drafts.set(docId, content);
        const doc = docs.find((d) => d.id === docId);
        if (doc) doc.content = content;
        onDisk.set(docId, content);
        return { ok: true };
      };
      if (!opts.deferred) return Promise.resolve(commit());
      // Async like a real persist, but held open until the test releases it.
      return new Promise<CaptureWriteOutcome>((resolve) => {
        pending.push(() => resolve(commit()));
      });
    },
  };

  return {
    writer,
    docs,
    drafts,
    onDisk,
    /** Release pending deferred writes, letting each queued capture run. */
    async flush() {
      // Each release may queue the next capture's write on a microtask, so
      // drain until nothing new shows up.
      for (let i = 0; i < 50; i++) {
        const next = pending.shift();
        if (!next) {
          await Promise.resolve();
          await Promise.resolve();
          if (pending.length === 0) return;
          continue;
        }
        next();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    pendingCount: () => pending.length,
    /** Release exactly one held write; false when none was waiting. */
    async flushOnce(): Promise<boolean> {
      const next = pending.shift();
      if (!next) return false;
      next();
      await tick();
      return true;
    },
    failNextWrites(n = 1, message = "disk full") {
      failNext = n;
      failWith = message;
    },
    diskBody(docId: string) {
      return onDisk.get(docId) ?? "";
    },
  };
}

/** Let the capture queue advance through its microtasks. */
async function tick(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

let w: ReturnType<typeof makeWriter>;

beforeEach(() => {
  resetCaptureQueues();
  w = makeWriter();
});

describe("captureExplain (B1)", () => {
  it("写到 读码笔记/<工程>/YYYY-MM-DD-<文件>.md 并带上问答与引用", async () => {
    const result = await captureExplain(w.writer, {
      question: "这个类在干什么？",
      answer: "它是入口，见 [[src/A.java:12]]。",
      projectName: "demo",
      sourcePath: "src/A.java",
      citations: [{ path: "src/A.java", line: 12 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(/^读码笔记\/demo\/\d{4}-\d{2}-\d{2}-A\.md$/);
    expect(result.renamed).toBe(false);

    const doc = w.docs.find((d) => d.id === result.docId)!;
    expect(doc.content).toContain("这个类在干什么？");
    expect(doc.content).toContain("它是入口");
    expect(doc.content).toContain("- 工程：**demo**");
    expect(doc.content).toContain("`src/A.java:12`");
    expect(doc.content).toContain("[[ide:src/A.java:12]]");
    // The file link itself carries the line, so clicking it lands on the answer,
    // not merely at the top of a 3000-line file.
    expect(doc.content).toContain(
      "- 文件：`src/A.java` · [[ide:src/A.java:12]]"
    );
  });

  it("同名笔记已存在时不再另建 -2.md，而是追加一节", async () => {
    const input = {
      question: "同一个问题",
      answer: "同一段讲解",
      projectName: "demo",
      sourcePath: "src/A.java",
      createdAt: new Date("2026-11-04T08:00:00Z").getTime(),
    };
    const first = await captureExplain(w.writer, input);
    const second = await captureExplain(w.writer, input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // One note per (day, file): the second capture lands inside the first.
    expect(w.docs).toHaveLength(1);
    expect(second.path).toBe(first.path);
    expect(second.docId).toBe(first.docId);
    expect(first.appended).toBe(false);
    expect(second.appended).toBe(true);
    expect(second.renamed).toBe(false);
    expect(captureStatusMessage(second)).toContain("已追加到");

    const body = w.docs[0]!.content;
    expect(body.match(/^# /gm)).toHaveLength(1);
    expect(body.match(/^## \d{2}:\d{2} · /gm)).toHaveLength(1);
    expect(body.indexOf("同一段讲解")).toBeGreaterThan(0);
    expect(w.diskBody(first.docId)).toBe(body);
  });

  it("同一天不同文件仍是两篇笔记", async () => {
    const day = new Date("2026-11-04T08:00:00Z").getTime();
    const a = await captureExplain(w.writer, {
      question: "q-a",
      answer: "a",
      projectName: "demo",
      sourcePath: "src/A.java",
      createdAt: day,
    });
    const b = await captureExplain(w.writer, {
      question: "q-b",
      answer: "b",
      projectName: "demo",
      sourcePath: "src/B.java",
      createdAt: day,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.path).not.toBe(b.path);
    expect(w.docs).toHaveLength(2);
  });

  it("跨天再收入会开新的一天笔记", async () => {
    const d1 = new Date(2026, 10, 4, 9, 0).getTime();
    const d2 = new Date(2026, 10, 5, 9, 0).getTime();
    const input = { question: "q", answer: "a", projectName: "demo", sourcePath: "src/A.java" };
    const first = await captureExplain(w.writer, { ...input, createdAt: d1 });
    const second = await captureExplain(w.writer, { ...input, createdAt: d2 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.path).not.toBe(second.path);
    expect(first.path).toMatch(/2026-11-04-A\.md$/);
    expect(second.path).toMatch(/2026-11-05-A\.md$/);
    expect(second.appended).toBe(false);
  });

  it("空回答不当成成功：给出可读原因", async () => {
    const result = await captureExplain(w.writer, {
      question: "q",
      answer: "   ",
      projectName: "demo",
      sourcePath: "src/A.java",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("讲解还没有内容");
    expect(w.docs).toHaveLength(0);
  });

  it("没有工程名 / 文件名的兜底路径仍然可写", async () => {
    const result = await captureExplain(w.writer, {
      question: "q",
      answer: "a",
      projectName: null,
      sourcePath: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toContain("读码笔记/未命名工程/");
  });

  it("写入磁盘失败时不报成功", async () => {
    w.failNextWrites(1, "磁盘只读");
    const result = await captureExplain(w.writer, {
      question: "q",
      answer: "a",
      projectName: "demo",
      sourcePath: "src/A.java",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("磁盘只读");
    expect(w.onDisk.size).toBe(0);
  });
});

describe("captureSnippet (B2)", () => {
  it("首次创建 读码笔记/速记.md，含标题块与来源链接", async () => {
    const result = await captureSnippet(w.writer, {
      path: "src/foo.ts",
      fromLine: 12,
      toLine: 14,
      text: "const a = 1;\nconst b = 2;\nconst c = 3;",
      lang: "ts",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe("读码笔记/速记.md");

    const doc = w.docs.find((d) => d.id === result.docId)!;
    expect(doc.content).toContain("### `src/foo.ts:12-14`");
    expect(doc.content).toContain("const b = 2;");
    expect(doc.content).toContain("```ts");
    expect(doc.content).toContain("[[ide:src/foo.ts:12-14]]");
  });

  it("再次收入是追加，不是覆盖", async () => {
    await captureSnippet(w.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "first()",
    });
    const second = await captureSnippet(w.writer, {
      path: "src/b.ts",
      fromLine: 5,
      toLine: 6,
      text: "second()",
    });

    expect(second.ok).toBe(true);
    expect(w.docs.filter((d) => d.path === "读码笔记/速记.md")).toHaveLength(1);
    const body = w.docs[0]!.content;
    expect(body).toContain("first()");
    expect(body).toContain("second()");
    expect(body.indexOf("first()")).toBeLessThan(body.indexOf("second()"));
  });

  it("超长选区被截断并注明", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const result = await captureSnippet(w.writer, {
      path: "src/big.ts",
      fromLine: 1,
      toLine: 200,
      text: long,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = w.docs.find((d) => d.id === result.docId)!;
    expect(doc.content).toContain("已截断");
    expect(doc.content).not.toContain("line199");
  });

  it("空选区拒绝写入", async () => {
    const result = await captureSnippet(w.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "  \n ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("选区是空的");
  });

  it("新建速记时使用统一表头", async () => {
    const result = await captureSnippet(w.writer, {
      path: "x.ts",
      fromLine: 1,
      toLine: 1,
      text: "x",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = w.docs.find((d) => d.id === result.docId)!;
    expect(doc.content.startsWith(SNIPPET_NOTE_HEADER.trimEnd())).toBe(true);
  });

  it("代码里本来就含三反引号时不会截断围栏", async () => {
    const result = await captureSnippet(w.writer, {
      path: "doc.md",
      fromLine: 1,
      toLine: 3,
      text: "```\ninner\n```",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = w.docs.find((d) => d.id === result.docId)!.content;
    expect(body).toContain("````");
    expect(body).toContain("inner");
  });

  it("写入失败时把原因回传给 UI，不留成功态", async () => {
    w.failNextWrites(1, "content/ 不可写");
    const result = await captureSnippet(w.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "blocked()",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("content/ 不可写");
    expect(w.onDisk.size).toBe(0);
  });
});

describe("captureSnippet 并发 (连点竞态)", () => {
  it("三次未完成的写入仍按点击顺序追加三段，不互相覆盖", async () => {
    const slow = makeWriter({ deferred: true });
    resetCaptureQueues();

    // Start all three before any persist resolves — the reported bug.
    const p1 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "FIRST()",
    });
    const p2 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 2,
      toLine: 2,
      text: "SECOND()",
    });
    const p3 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 3,
      toLine: 3,
      text: "THIRD()",
    });

    // Only the first capture may be in flight: the queue serializes the rest.
    await tick();
    expect(slow.pendingCount()).toBe(1);

    await slow.flush();
    const results = await Promise.all([p1, p2, p3]);
    expect(results.every((r) => r.ok)).toBe(true);

    // One note, one creation — later captures appended to the same doc.
    expect(slow.docs.filter((d) => d.path === "读码笔记/速记.md")).toHaveLength(1);
    const docId = slow.docs[0]!.id;
    const disk = slow.diskBody(docId);
    for (const marker of ["FIRST()", "SECOND()", "THIRD()"]) {
      expect(disk).toContain(marker);
    }
    expect(disk.indexOf("FIRST()")).toBeLessThan(disk.indexOf("SECOND()"));
    expect(disk.indexOf("SECOND()")).toBeLessThan(disk.indexOf("THIRD()"));
    expect(disk.match(/^### `/gm)).toHaveLength(3);
  });

  it("前一次失败不阻塞后一次，且只有成功的块落到磁盘", async () => {
    const slow = makeWriter({ deferred: true });
    resetCaptureQueues();

    // First block lands normally…
    const p1 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "kept()",
    });
    await tick();
    expect(await slow.flushOnce()).toBe(true);
    // …then the second write fails.
    slow.failNextWrites(1, "第一次失败");
    const p2 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 2,
      toLine: 2,
      text: "lost()",
    });
    // Third must still run after the failed one.
    const p3 = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 3,
      toLine: 3,
      text: "after()",
    });

    await slow.flush();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.message).toContain("第一次失败");
    expect(r3.ok).toBe(true);

    const disk = slow.diskBody(slow.docs[0]!.id);
    expect(disk).toContain("kept()");
    expect(disk).toContain("after()");
    expect(disk).not.toContain("lost()");
    expect(disk.indexOf("kept()")).toBeLessThan(disk.indexOf("after()"));
  });

  it("不同笔记之间互不排队", async () => {
    const slow = makeWriter({ deferred: true });
    resetCaptureQueues();
    const snippet = captureSnippet(slow.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "snippet()",
    });
    await Promise.resolve();
    // The snippet write is held; an explain note on another path still starts.
    const explain = captureExplain(slow.writer, {
      question: "q",
      answer: "a",
      projectName: "demo",
      sourcePath: "src/a.ts",
    });
    await Promise.resolve();
    expect(slow.pendingCount()).toBe(2);

    slow.flush();
    const [a, b] = await Promise.all([snippet, explain]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
