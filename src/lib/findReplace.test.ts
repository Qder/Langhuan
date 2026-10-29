import { describe, expect, it } from "vitest";
import {
  FIND_REPLACE_PREVIEW_CAP,
  contentSearchWindow,
  filterDocsForFindReplace,
  findInDocument,
  findLiteralRanges,
  isWholeWordAt,
  replaceLiteralInContent,
  scanFindReplace,
  summarizeScan,
  type FindReplaceQuery,
} from "./findReplace";
import type { Document } from "./types";

function doc(
  partial: Partial<Document> & Pick<Document, "id" | "path" | "type" | "content">
): Document {
  return {
    starred: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const baseQuery = (
  over: Partial<FindReplaceQuery> & Pick<FindReplaceQuery, "find">
): FindReplaceQuery => ({
  replaceWith: "",
  caseSensitive: false,
  wholeWord: false,
  scope: "library",
  fileTypes: "all",
  includeFrontMatter: false,
  ...over,
});

describe("isWholeWordAt", () => {
  it("ASCII word boundaries", () => {
    expect(isWholeWordAt("foo bar", 0, 3)).toBe(true);
    expect(isWholeWordAt("foobar", 0, 3)).toBe(false);
    expect(isWholeWordAt("a foo", 2, 5)).toBe(true);
    expect(isWholeWordAt("afoo", 1, 4)).toBe(false);
  });

  it("Chinese matches per character without false \\b", () => {
    expect(isWholeWordAt("标题记录尾", 2, 4)).toBe(true);
    expect(isWholeWordAt("记录", 0, 2)).toBe(true);
  });
});

describe("findLiteralRanges", () => {
  it("literal case-insensitive", () => {
    const r = findLiteralRanges("Foo foo FOO", "foo", { caseSensitive: false });
    expect(r).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("literal case-sensitive", () => {
    const r = findLiteralRanges("Foo foo FOO", "foo", { caseSensitive: true });
    expect(r).toEqual([{ start: 4, end: 7 }]);
  });

  it("whole word skips substrings", () => {
    const r = findLiteralRanges("cat catalog cat", "cat", {
      caseSensitive: true,
      wholeWord: true,
    });
    expect(r).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
    ]);
  });

  it("respects rangeStart (skip front matter region)", () => {
    const content = "---\ntags: [foo]\n---\nfoo bar";
    const body = contentSearchWindow(content, "md", false);
    expect(body.start).toBeGreaterThan(0);
    const r = findLiteralRanges(content, "foo", {
      caseSensitive: true,
      rangeStart: body.start,
      rangeEnd: body.end,
    });
    expect(r).toHaveLength(1);
    expect(content.slice(r[0]!.start, r[0]!.end)).toBe("foo");
    expect(r[0]!.start).toBeGreaterThanOrEqual(body.start);
  });

  it("empty find yields no matches", () => {
    expect(findLiteralRanges("abc", "", {})).toEqual([]);
  });
});

describe("contentSearchWindow / front matter", () => {
  it("default MD skips YAML; includeFrontMatter searches all", () => {
    const content = "---\ntags: [foo]\n---\nfoo";
    const body = contentSearchWindow(content, "md", false);
    const all = contentSearchWindow(content, "md", true);
    expect(body.start).toBe(all.start + "---\ntags: [foo]\n---\n".length);
    expect(all.start).toBe(0);
  });

  it("HTML always full content", () => {
    const content = "<p>foo</p>";
    expect(contentSearchWindow(content, "html", false)).toEqual({
      start: 0,
      end: content.length,
    });
  });
});

describe("replaceLiteralInContent", () => {
  it("replaces all and preserves surroundings", () => {
    const content = "alpha foo beta foo gamma";
    const { content: next, count } = replaceLiteralInContent(content, {
      find: "foo",
      replaceWith: "bar",
      caseSensitive: true,
      wholeWord: false,
      includeFrontMatter: true,
      docType: "md",
    });
    expect(count).toBe(2);
    expect(next).toBe("alpha bar beta bar gamma");
  });

  it("default MD does not replace inside YAML", () => {
    const content = "---\ntags: [foo]\n---\nfoo";
    const { content: next, count } = replaceLiteralInContent(content, {
      find: "foo",
      replaceWith: "bar",
      caseSensitive: true,
      wholeWord: false,
      includeFrontMatter: false,
      docType: "md",
    });
    expect(count).toBe(1);
    expect(next).toBe("---\ntags: [foo]\n---\nbar");
  });

  it("onlyStarts limits which matches are replaced", () => {
    const content = "foo foo foo";
    const ranges = findLiteralRanges(content, "foo", { caseSensitive: true });
    const { content: next, count } = replaceLiteralInContent(
      content,
      {
        find: "foo",
        replaceWith: "X",
        caseSensitive: true,
        wholeWord: false,
        includeFrontMatter: true,
        docType: "md",
      },
      [ranges[1]!.start]
    );
    expect(count).toBe(1);
    expect(next).toBe("foo X foo");
  });

  it("no hit → unchanged", () => {
    const { content: next, count } = replaceLiteralInContent("hello", {
      find: "zzz",
      replaceWith: "a",
      caseSensitive: false,
      wholeWord: false,
      includeFrontMatter: true,
      docType: "md",
    });
    expect(count).toBe(0);
    expect(next).toBe("hello");
  });

  it("multi-doc scan counts", () => {
    const docs = [
      doc({ id: "1", path: "a.md", type: "md", content: "foo one" }),
      doc({ id: "2", path: "b.md", type: "md", content: "nothing" }),
      doc({ id: "3", path: "c.md", type: "md", content: "foo two foo" }),
    ];
    const map = Object.fromEntries(docs.map((d) => [d.id, d.content]));
    const results = scanFindReplace(
      docs,
      (id) => map[id]!,
      baseQuery({ find: "foo", caseSensitive: true }),
      { activeId: null }
    );
    const sum = summarizeScan(results);
    expect(sum.docCount).toBe(2);
    expect(sum.hitCount).toBe(3);
  });
});

describe("filterDocsForFindReplace", () => {
  const docs = [
    doc({ id: "1", path: "日记/a.md", type: "md", content: "" }),
    doc({ id: "2", path: "日记/b.html", type: "html", content: "" }),
    doc({ id: "3", path: "其他/c.md", type: "md", content: "" }),
  ];

  it("current doc only", () => {
    const r = filterDocsForFindReplace(
      docs,
      { scope: "current", fileTypes: "all" },
      { activeId: "1", activePath: "日记/a.md" }
    );
    expect(r.map((d) => d.id)).toEqual(["1"]);
  });

  it("folder + md only", () => {
    const r = filterDocsForFindReplace(
      docs,
      { scope: "folder", fileTypes: "md" },
      { activeId: "1", activePath: "日记/a.md" }
    );
    expect(r.map((d) => d.id)).toEqual(["1"]);
  });

  it("library html", () => {
    const r = filterDocsForFindReplace(
      docs,
      { scope: "library", fileTypes: "html" },
      { activeId: null }
    );
    expect(r.map((d) => d.id)).toEqual(["2"]);
  });
});

describe("findInDocument preview cap", () => {
  it("truncates preview but keeps totalCount", () => {
    const needle = "x";
    const content = Array.from({ length: FIND_REPLACE_PREVIEW_CAP + 3 }, () => needle).join(" ");
    const d = doc({ id: "1", path: "big.md", type: "md", content });
    const result = findInDocument(
      d,
      content,
      {
        find: needle,
        caseSensitive: true,
        wholeWord: true,
        includeFrontMatter: true,
      },
      { previewCap: FIND_REPLACE_PREVIEW_CAP }
    );
    expect(result.totalCount).toBe(FIND_REPLACE_PREVIEW_CAP + 3);
    expect(result.truncated).toBe(true);
    expect(result.hits).toHaveLength(FIND_REPLACE_PREVIEW_CAP);
  });
});

describe("YAML default regression", () => {
  it("查找 foo 在 ---\ntags: [foo]\n---\nfoo 只命中正文", () => {
    const content = "---\ntags: [foo]\n---\nfoo";
    const d = doc({ id: "1", path: "n.md", type: "md", content });
    const result = findInDocument(d, content, {
      find: "foo",
      caseSensitive: true,
      wholeWord: false,
      includeFrontMatter: false,
    });
    expect(result.totalCount).toBe(1);
    expect(result.hits[0]!.lineText).toBe("foo");
  });
});
