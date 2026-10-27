import { describe, expect, it } from "vitest";
import { parseSearchQuery, segmentTerms } from "./searchQuery";

describe("parseSearchQuery", () => {
  it("extracts tag path type filters", () => {
    const p = parseSearchQuery('双链 tag:验收 path:页面/ type:html 笔记');
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
});

describe("segmentTerms", () => {
  it("returns non-empty terms for Chinese", () => {
    const terms = segmentTerms("双链笔记");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.join("")).toContain("双");
  });
});
