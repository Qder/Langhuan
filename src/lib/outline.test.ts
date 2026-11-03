import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  extractOutline,
  outlineHeadingText,
  resolveActiveHeadingId,
  headingViewportTops,
  scrollOffsetForHeading,
  planOutlineJump,
  findOutlineHeadingEl,
  normalizeOutlineMatchText,
  OUTLINE_SPY_THRESHOLD_PX,
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

  it("slugs 4.1 主析取范式 PDNF for text-fallback pairing", () => {
    const o = extractOutline("### 4.1 主析取范式 PDNF\n\nbody\n");
    expect(o).toHaveLength(1);
    expect(o[0].id).toBe("41-主析取范式-pdnf");
    expect(o[0].text).toBe("4.1 主析取范式 PDNF");
    expect(normalizeOutlineMatchText(o[0].text)).toBe(
      normalizeOutlineMatchText("4.1 主析取范式 PDNF")
    );
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

describe("scrollOffsetForHeading / planOutlineJump", () => {
  it("subtracts spy threshold and clamps at 0", () => {
    expect(scrollOffsetForHeading(500, 120)).toBe(380);
    expect(scrollOffsetForHeading(50, OUTLINE_SPY_THRESHOLD_PX)).toBe(0);
  });

  it("plans scrollTop from heading content offset inside reader-scroll", () => {
    const rect = (top: number): DOMRect =>
      ({
        top,
        left: 0,
        right: 0,
        bottom: top,
        width: 0,
        height: 0,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const root = {
      scrollTop: 200,
      getBoundingClientRect: () => rect(100),
    } as unknown as HTMLElement;
    const heading = {
      id: "常用等值式",
      getBoundingClientRect: () => rect(400),
    } as unknown as HTMLElement;
    // contentTop = 400 - 100 + 200 = 500 → scrollTop = 500 - 120 = 380
    expect(planOutlineJump(root, heading, 120)).toEqual({
      ok: true,
      scrollTop: 380,
      headingId: "常用等值式",
    });
  });

  it("fails cleanly when root or heading missing", () => {
    expect(planOutlineJump(null, {} as HTMLElement)).toEqual({
      ok: false,
      reason: "no-root",
    });
    expect(planOutlineJump({} as HTMLElement, null)).toEqual({
      ok: false,
      reason: "no-heading",
    });
  });
});

describe("findOutlineHeadingEl", () => {
  const prevDoc = globalThis.document;
  const prevCSS = (globalThis as { CSS?: unknown }).CSS;

  afterEach(() => {
    globalThis.document = prevDoc;
    (globalThis as { CSS?: unknown }).CSS = prevCSS;
  });

  function mount(html: string) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    globalThis.document = dom.window.document;
    (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/"/g, '\\"'),
    };
    return dom.window.document;
  }

  it("finds by id when present", () => {
    const doc = mount(
      `<div id="reader-scroll"><h3 id="41-主析取范式-pdnf">4.1 主析取范式 PDNF</h3></div>`
    );
    const root = doc.getElementById("reader-scroll");
    const el = findOutlineHeadingEl("41-主析取范式-pdnf", root, "4.1 主析取范式 PDNF");
    expect(el?.tagName).toBe("H3");
    expect(el?.id).toBe("41-主析取范式-pdnf");
  });

  it("finds sanitize-clobbered user-content- id", () => {
    const doc = mount(
      `<div id="reader-scroll"><h3 id="user-content-41-主析取范式-pdnf">4.1 主析取范式 PDNF</h3></div>`
    );
    const root = doc.getElementById("reader-scroll");
    const el = findOutlineHeadingEl("41-主析取范式-pdnf", root);
    expect(el?.id).toBe("user-content-41-主析取范式-pdnf");
  });

  it("falls back to normalized text when id missing", () => {
    const doc = mount(
      `<div id="reader-scroll"><h3>4.1 主析取范式 PDNF</h3></div>`
    );
    const root = doc.getElementById("reader-scroll");
    const el = findOutlineHeadingEl(
      "41-主析取范式-pdnf",
      root,
      "4.1 主析取范式 PDNF"
    );
    expect(el?.textContent).toBe("4.1 主析取范式 PDNF");
    expect(el?.id).toBe("");
  });

  it("prefers id match among duplicate text headings", () => {
    const doc = mount(
      `<div id="reader-scroll">
        <h3>小结</h3>
        <h3 id="小结-1">小结</h3>
      </div>`
    );
    const root = doc.getElementById("reader-scroll");
    const el = findOutlineHeadingEl("小结-1", root, "小结");
    expect(el?.id).toBe("小结-1");
  });
});
