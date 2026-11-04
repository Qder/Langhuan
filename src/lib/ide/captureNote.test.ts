import { describe, expect, it } from "vitest";
import {
  IDE_NOTE_ROOT,
  SNIPPET_MAX_CHARS,
  appendSnippetBlock,
  buildExplainNote,
  buildSnippetBlock,
  explainNotePath,
  noteDateStamp,
  noteFileStem,
  safeFence,
  sanitizeNoteSegment,
  snippetNotePath,
  truncateSnippet,
} from "./captureNote";
import { parseIdeLinkTarget } from "./ideLink";

describe("sanitizeNoteSegment", () => {
  it("replaces path-hostile characters", () => {
    expect(sanitizeNoteSegment("a/b\\c:d*e?f")).toBe("a-b-c-d-e-f");
    expect(sanitizeNoteSegment("  spaced  name ")).toBe("spaced name");
  });

  it("never returns empty", () => {
    expect(sanitizeNoteSegment("")).toBe("未命名");
    expect(sanitizeNoteSegment("...")).toBe("未命名");
    expect(sanitizeNoteSegment("///", "工程")).toBe("工程");
  });
});

describe("noteDateStamp", () => {
  it("formats local YYYY-MM-DD", () => {
    expect(noteDateStamp(new Date(2026, 10, 4))).toBe("2026-11-04");
    expect(noteDateStamp(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("noteFileStem", () => {
  it("strips directories and the extension", () => {
    expect(noteFileStem("src/foo/Bar.java")).toBe("Bar");
    expect(noteFileStem("a/b/notes.md")).toBe("notes");
    expect(noteFileStem("Makefile")).toBe("Makefile");
  });
});

describe("explainNotePath", () => {
  it("nests under 读码笔记/<project>/date-stem.md", () => {
    expect(
      explainNotePath({
        projectName: "demo",
        sourcePath: "src/a/B.java",
        date: "2026-11-04",
      })
    ).toBe(`${IDE_NOTE_ROOT}/demo/2026-11-04-B.md`);
  });

  it("sanitizes project names and falls back when missing", () => {
    expect(
      explainNotePath({ projectName: "a/b", sourcePath: "x.ts", date: "2026-01-02" })
    ).toBe(`${IDE_NOTE_ROOT}/a-b/2026-01-02-x.md`);
    expect(
      explainNotePath({ projectName: null, sourcePath: "x.ts", date: "2026-01-02" })
    ).toBe(`${IDE_NOTE_ROOT}/未命名工程/2026-01-02-x.md`);
  });

  it("keeps 速记 on its own path", () => {
    expect(snippetNotePath()).toBe(`${IDE_NOTE_ROOT}/速记.md`);
  });
});

describe("buildExplainNote", () => {
  it("writes frontmatter, question, answer, and source block", () => {
    const md = buildExplainNote({
      question: "这个文件在干什么？",
      answer: "它负责读文件。见 `src/a.ts:12`。",
      projectName: "demo",
      sourcePath: "src/a.ts",
      citations: [{ path: "src/a.ts", line: 12 }],
      createdAt: new Date(2026, 10, 4, 13, 30).getTime(),
    });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("tags: [读码]");
    expect(md).toContain("## 问题");
    expect(md).toContain("这个文件在干什么？");
    expect(md).toContain("## 讲解");
    expect(md).toContain("它负责读文件。");
    expect(md).toContain("- 工程：**demo**");
    expect(md).toContain("`src/a.ts`");
    expect(md).toContain("## 引用");
    expect(md).toContain("`src/a.ts:12`");
    expect(md).toContain("[[ide:src/a.ts:12]]");
  });

  it("dedupes citations and keeps a wider range", () => {
    const md = buildExplainNote({
      question: "q",
      answer: "a",
      citations: [
        { path: "src/a.ts", line: 4 },
        { path: "src/a.ts", line: 4, endLine: 9 },
        { path: "src/a.ts", line: 4 },
      ],
    });
    const refs = md.split("\n").filter((l) => l.startsWith("- `src/a.ts"));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toContain("[[ide:src/a.ts:4-9]]");
  });

  it("records the answer even when the model produced nothing", () => {
    const md = buildExplainNote({ question: "q", answer: "   " });
    expect(md).toContain("（讲解没有返回内容）");
  });

  it("keeps quotes in the title (they are not path characters)", () => {
    const md = buildExplainNote({ question: 'a "b" c', answer: "x" });
    expect(md).toContain('title: "a \\"b\\" c"');
  });

  it("never produces a punctuation-only filename segment", () => {
    expect(sanitizeNoteSegment("...")).toBe("未命名");
    expect(sanitizeNoteSegment("///", "工程")).toBe("工程");
  });
});

describe("truncateSnippet", () => {
  it("keeps short snippets untouched", () => {
    const r = truncateSnippet("one\ntwo");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("one\ntwo");
    expect(r.totalLines).toBe(2);
  });

  it("caps lines and reports the original size", () => {
    const body = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n");
    const r = truncateSnippet(body, { maxLines: 10 });
    expect(r.truncated).toBe(true);
    expect(r.text.split("\n")).toHaveLength(10);
    expect(r.totalLines).toBe(120);
    expect(r.totalChars).toBe(body.length);
  });

  it("caps characters too", () => {
    const r = truncateSnippet("x".repeat(500), { maxChars: 100 });
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(100);
  });

  it("normalizes CRLF and trims trailing blank lines", () => {
    const r = truncateSnippet("a\r\nb\r\n\r\n");
    expect(r.text).toBe("a\nb");
  });
});

describe("safeFence", () => {
  it("grows past fences inside the snippet", () => {
    expect(safeFence("plain")).toBe("```");
    expect(safeFence("```js\nx\n```")).toBe("````");
    expect(safeFence("````")).toBe("`````");
  });
});

describe("buildSnippetBlock", () => {
  it("writes the heading, fence, and source link", () => {
    const block = buildSnippetBlock({
      path: "src/foo.ts",
      fromLine: 12,
      toLine: 20,
      text: "const a = 1;",
      lang: "ts",
    });
    expect(block).toContain("### `src/foo.ts:12-20`");
    expect(block).toContain("```ts\nconst a = 1;\n```");
    expect(block).toContain("来源：[[ide:src/foo.ts:12-20]]");
  });

  it("collapses a single-line range", () => {
    const block = buildSnippetBlock({
      path: "src/a.ts",
      fromLine: 7,
      toLine: 7,
      text: "x",
    });
    expect(block).toContain("### `src/a.ts:7`");
    expect(block).toContain("来源：[[ide:src/a.ts:7]]");
  });

  it("notes truncation instead of silently cutting", () => {
    const text = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const block = buildSnippetBlock({
      path: "src/a.ts",
      fromLine: 1,
      toLine: 100,
      text,
    });
    expect(block).toContain("已截断");
    expect(block).toContain("原始 100 行");
  });

  it("handles a snippet containing triple backticks", () => {
    const block = buildSnippetBlock({
      path: "src/a.md",
      fromLine: 1,
      toLine: 3,
      text: "```\nx\n```",
    });
    expect(block).toContain("````\n```\nx\n```\n````");
  });
});

describe("appendSnippetBlock", () => {
  it("creates the 速记 header on first append", () => {
    const out = appendSnippetBlock("", "BLOCK");
    expect(out.startsWith("# 速记")).toBe(true);
    expect(out.trimEnd().endsWith("BLOCK")).toBe(true);
  });

  it("appends without eating the previous block", () => {
    const first = appendSnippetBlock("", "A");
    const second = appendSnippetBlock(first, "B");
    expect(second).toContain("A");
    expect(second.trimEnd().endsWith("B")).toBe(true);
    expect(second.includes("\n\n\n")).toBe(false);
  });
});

describe("capture note body round-trips to ide links", () => {
  it("every generated ide link parses back to the same target", () => {
    const md = buildExplainNote({
      question: "q",
      answer: "a",
      projectName: "demo",
      sourcePath: "src/a.ts",
      citations: [{ path: "src/a.ts", line: 4, endLine: 9 }],
    });
    const links = [...md.matchAll(/\[\[(ide:[^\]]+)\]\]/g)].map((m) => m[1]!);
    // First is the bare file link, then the cited range.
    expect(links).toContain("ide:src/a.ts");
    expect(parseIdeLinkTarget(links[links.length - 1]!)).toEqual({
      path: "src/a.ts",
      line: 4,
      endLine: 9,
    });
    expect(SNIPPET_MAX_CHARS).toBeGreaterThan(0);
  });
});
