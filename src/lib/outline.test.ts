import { describe, expect, it } from "vitest";
import {
  extractOutline,
  outlineHeadingText,
  resolveActiveHeadingId,
  headingViewportTops,
} from "./outline";

describe("extractOutline", () => {
  it("slugs Chinese headings like rehype-slug / github-slugger", () => {
    const md = "# 命题逻辑\n\n## 四、常用推理定律\n\n### 5.2 等值演算\n";
    const o = extractOutline(md);
    expect(o.map((h) => h.id)).toEqual([
      "命题逻辑",
      "四常用推理定律",
      "52-等值演算",
    ]);
    expect(o.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it("uniquifies duplicate heading ids", () => {
    const md = "## 测试\n\n## 测试\n";
    expect(extractOutline(md).map((h) => h.id)).toEqual(["测试", "测试-1"]);
  });

  it("skips frontmatter and strips inline markers", () => {
    const md = "---\ntitle: x\n---\n\n## **加粗**标题\n";
    const o = extractOutline(md);
    expect(o).toHaveLength(1);
    expect(o[0].text).toBe("加粗标题");
    expect(o[0].id).toBe("加粗标题");
  });
});

describe("outlineHeadingText", () => {
  it("strips markers", () => {
    expect(outlineHeadingText("四、**常用**")).toBe("四、常用");
  });
});

describe("resolveActiveHeadingId", () => {
  // Document order: a, b, c — tops as getBoundingClientRect().top while scrolling
  const heads = [
    { id: "a", top: 20 },
    { id: "b", top: 100 },
    { id: "c", top: 400 },
  ];

  it("picks last heading past threshold", () => {
    expect(resolveActiveHeadingId(heads, 120)).toBe("b");
    expect(resolveActiveHeadingId(heads, 50)).toBe("a");
    expect(resolveActiveHeadingId(heads, 400)).toBe("c");
  });

  it("returns empty when none have passed", () => {
    expect(resolveActiveHeadingId(heads, 10)).toBe("");
    expect(resolveActiveHeadingId([{ id: "a", top: 400 }], 120)).toBe("");
  });

  it("handles empty list", () => {
    expect(resolveActiveHeadingId([], 120)).toBe("");
  });
});

describe("headingViewportTops", () => {
  it("converts content tops to viewport Y", () => {
    const heads = [
      { id: "a", contentTop: 100 },
      { id: "b", contentTop: 300 },
    ];
    expect(headingViewportTops(heads, 50, 10)).toEqual([
      { id: "a", top: 60 },
      { id: "b", top: 260 },
    ]);
  });
});

