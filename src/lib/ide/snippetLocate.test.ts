import { describe, expect, it } from "vitest";
import {
  locateSnippetInFiles,
  parseExplainFences,
  SNIPPET_MIN_COLLAPSED_CHARS,
} from "./snippetLocate";
import { parseIdeCitations } from "./citations";
import { buildMockExplainMarkdown } from "./explain";

describe("parseExplainFences", () => {
  it("reads fence info path:line and path-only", () => {
    const md = [
      "```java src/foo/Bar.java:12-40",
      "class Bar {}",
      "```",
      "",
      "```java src/foo/Bar.java",
      "void x() {}",
      "```",
    ].join("\n");
    const fences = parseExplainFences(md);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toMatchObject({
      lang: "java",
      path: "src/foo/Bar.java",
      line: 12,
      endLine: 40,
      body: "class Bar {}",
    });
    expect(fences[1]).toMatchObject({
      path: "src/foo/Bar.java",
      line: undefined,
      body: "void x() {}",
    });
  });

  it("plain ```java with no path is still a fence", () => {
    const md = "```java\nint n = 1;\n```";
    const fences = parseExplainFences(md);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.path).toBeUndefined();
    expect(fences[0]!.body).toBe("int n = 1;");
    expect(parseIdeCitations(md)).toEqual([]);
  });
});

describe("parseIdeCitations fence info with lines", () => {
  it("picks up ```lang path:12-20", () => {
    const md = "```ts src/a.ts:12-20\nexport const a = 1;\n```";
    const hits = parseIdeCitations(md);
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/a.ts",
          line: 12,
          endLine: 20,
        }),
      ])
    );
  });
});

describe("locateSnippetInFiles", () => {
  const file = {
    path: "src/A.java",
    content: "package demo;\n\npublic class A {\n  void run() {}\n}\n",
    startLine: 1,
  };

  it("unique substring → line numbers", () => {
    const r = locateSnippetInFiles("public class A {\n  void run() {}", [file]);
    expect(r).toEqual({
      ok: true,
      path: "src/A.java",
      line: 3,
      endLine: 4,
      precision: "exact",
    });
  });

  it("duplicate substring → candidates, no guess", () => {
    const token = "UNIQUE_MARK_TOKEN";
    const r = locateSnippetInFiles(token, [
      { path: "a.txt", content: `${token}\nkeep\n${token}`, startLine: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates).toEqual(["a.txt"]);
    }
  });

  it("same snippet in two files → candidates", () => {
    const body = "function hello() { return 1; }";
    const r = locateSnippetInFiles(body, [
      { path: "src/a.ts", content: `x\n${body}\n`, startLine: 1 },
      { path: "src/b.ts", content: `${body}\n`, startLine: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    }
  });

  it("whitespace-collapsed still hits", () => {
    const r = locateSnippetInFiles("public   class   A {", [file]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe("src/A.java");
      expect(r.line).toBe(3);
      expect(r.precision).toBe("whitespace");
    }
  });

  it("too-short / empty", () => {
    expect(locateSnippetInFiles("   ", [file])).toMatchObject({
      ok: false,
      reason: "empty",
    });
    const tiny = "x".repeat(Math.max(1, SNIPPET_MIN_COLLAPSED_CHARS - 1));
    expect(locateSnippetInFiles(tiny, [file])).toMatchObject({
      ok: false,
      reason: "too-short",
    });
  });

  it("respects startLine offset of a sliced payload", () => {
    const r = locateSnippetInFiles("void run() {}", [
      {
        path: "src/A.java",
        content: "  void run() {}",
        startLine: 4,
      },
    ]);
    expect(r).toMatchObject({ ok: true, path: "src/A.java", line: 4 });
  });
});

describe("mock explain includes a pathless fence from the file", () => {
  it("fence body locates in the attached file", () => {
    const content = "package demo;\n\npublic class A {\n  void run() {}\n}\n";
    const md = buildMockExplainMarkdown({
      question: "这个类干什么",
      files: [{ path: "src/A.java", content, startLine: 1 }],
    });
    const fences = parseExplainFences(md);
    const pathless = fences.find((f) => !f.path);
    expect(pathless).toBeTruthy();
    const r = locateSnippetInFiles(pathless!.body, [
      { path: "src/A.java", content, startLine: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe("src/A.java");
  });
});
