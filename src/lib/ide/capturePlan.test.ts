/**
 * 读码 → 藏书阁 写入计划 (B1 / B2).
 *
 * A tiny in-memory writer stands in for the notes store: these tests care about
 * path choice, dedupe-by-suffix reporting, truncation notes, and append order —
 * not about idb persistence (covered elsewhere).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureExplain,
  captureSnippet,
  captureStatusMessage,
  type NoteWriter,
} from "./capturePlan";
import { SNIPPET_NOTE_HEADER } from "./captureNote";

type FakeDoc = { id: string; path: string; content: string };

function makeWriter() {
  const docs: FakeDoc[] = [];
  const drafts = new Map<string, string>();
  let seq = 0;
  const writer: NoteWriter = {
    findByPath: (path) => docs.find((d) => d.path === path),
    contentOf: (docId) => drafts.get(docId) ?? docs.find((d) => d.id === docId)!.content,
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
      drafts.set(docId, content);
      const doc = docs.find((d) => d.id === docId);
      if (doc) doc.content = content;
    },
  };
  return { writer, docs, drafts };
}

let w: ReturnType<typeof makeWriter>;

beforeEach(() => {
  w = makeWriter();
});

describe("captureExplain (B1)", () => {
  it("写到 读码笔记/<工程>/YYYY-MM-DD-<文件>.md 并带上问答与引用", () => {
    const result = captureExplain(w.writer, {
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
  });

  it("同名笔记已存在时加后缀，并把真实路径回报给 UI", () => {
    const input = {
      question: "同一个问题",
      answer: "同一段讲解",
      projectName: "demo",
      sourcePath: "src/A.java",
      createdAt: new Date("2026-11-04T08:00:00Z").getTime(),
    };
    const first = captureExplain(w.writer, input);
    const second = captureExplain(w.writer, input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.path).not.toBe(first.path);
    expect(second.path).toMatch(/-2\.md$/);
    expect(second.renamed).toBe(true);
    expect(captureStatusMessage(second)).toContain("重名已加后缀");
  });

  it("空回答不当成成功：给出可读原因", () => {
    const result = captureExplain(w.writer, {
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

  it("没有工程名 / 文件名的兜底路径仍然可写", () => {
    const result = captureExplain(w.writer, {
      question: "q",
      answer: "a",
      projectName: null,
      sourcePath: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toContain("读码笔记/未命名工程/");
  });
});

describe("captureSnippet (B2)", () => {
  it("首次创建 读码笔记/速记.md，含标题块与来源链接", () => {
    const result = captureSnippet(w.writer, {
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

  it("再次收入是追加，不是覆盖", () => {
    captureSnippet(w.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "first()",
    });
    const second = captureSnippet(w.writer, {
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

  it("超长选区被截断并注明", () => {
    const long = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const result = captureSnippet(w.writer, {
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

  it("空选区拒绝写入", () => {
    const result = captureSnippet(w.writer, {
      path: "src/a.ts",
      fromLine: 1,
      toLine: 1,
      text: "  \n ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("选区是空的");
  });

  it("新建速记时使用统一表头", () => {
    const result = captureSnippet(w.writer, {
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

  it("代码里本来就含三反引号时不会截断围栏", () => {
    const result = captureSnippet(w.writer, {
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
});
