import { describe, expect, it } from "vitest";
import { parseSearchQuery, segmentTerms } from "./searchQuery";

describe("parseSearchQuery", () => {
  it("extracts tag path type filters", () => {
    const p = parseSearchQuery("双链 tag:验收 path:页面/ type:html 笔记");
    expect(p.tags).toEqual(["验收"]);
    expect(p.path).toBe("页面/");
    expect(p.type).toBe("html");
    expect(p.text).toContain("双链");
    expect(p.text).toContain("笔记");
    expect(p.text).not.toMatch(/tag:/);
  });

  it("supports quoted tag values", () => {
    expect(parseSearchQuery('tag:"待整理" hello').tags).toEqual(["待整理"]);
  });

  it("supports title: filter", () => {
    const p = parseSearchQuery("title:双链 其他");
    expect(p.titles).toEqual(["双链"]);
    expect(p.text).toContain("其他");
  });

  it('extracts "exact phrases"', () => {
    const p = parseSearchQuery('hello "binary search" world');
    expect(p.phrases).toEqual(["binary search"]);
    expect(p.text).toContain("hello");
    expect(p.text).toContain("world");
    expect(p.text).not.toContain("binary");
  });

  it("supports -exclude", () => {
    const p = parseSearchQuery("双链 -HTML");
    expect(p.excludes).toEqual(["HTML"]);
    expect(p.text).toBe("双链");
  });

  it("unclosed quote falls back to plain text (no throw)", () => {
    const p = parseSearchQuery('hello "binary search');
    expect(p.phrases).toEqual([]);
    expect(p.text).toContain("hello");
    expect(p.text).toContain('"binary');
  });
});

describe("segmentTerms", () => {
  it("returns non-empty terms for Chinese", () => {
    const terms = segmentTerms("双链笔记");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.join("")).toContain("双");
  });
});
