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
  effectiveZoom,
  scrollTopForViewportDelta,
  OUTLINE_SPY_THRESHOLD_PX,
  MAX_OUTLINE_DEPTH,
  measureHeadingContentTops,
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

  it("默认包含 h4（长文末级小节），h5/h6 不进目录", () => {
    const md = [
      "# 一章",
      "#### 1.1.1 末级小节",
      "##### 太深了",
      "###### 更深",
      "",
    ].join("\n\n");
    const o = extractOutline(md);
    expect(o.map((h) => `${h.level}:${h.text}`)).toEqual(["1:一章", "4:1.1.1 末级小节"]);
    expect(o[1]!.id).toBe("111-末级小节");
  });

  it("深度由 MAX_OUTLINE_DEPTH 决定（h1–h4 全在，顺序与层级不丢）", () => {
    expect(MAX_OUTLINE_DEPTH).toBe(4);
    const o = extractOutline("## a\n#### b\n### c\n");
    expect(o.map((h) => h.level)).toEqual([2, 4, 3]);
  });
});

describe("outlineHeadingText", () => {
  it("strips markers", () => {
    expect(outlineHeadingText("四、**常用**")).toBe("四、常用");
  });
});

describe("measureHeadingContentTops（滚动高亮）", () => {
  const prevDoc = globalThis.document;

  afterEach(() => {
    globalThis.document = prevDoc;
  });

  it("h4 也参与测量，否则点得进去却高亮不到", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div id="reader-scroll">
          <article>
            <h1 id="a">A</h1>
            <h4 id="b">B</h4>
            <h5 id="c">C</h5>
          </article>
        </div>
      </body></html>`
    );
    const doc = dom.window.document;
    globalThis.document = doc;
    const root = doc.getElementById("reader-scroll")!;
    const article = root.querySelector("article")!;
    // jsdom 没有布局：所有 rect 都是 0，验证的是「选中了哪些节点」。
    const measured = measureHeadingContentTops(root, article);
    expect(measured.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("resolveActiveHeadingId", () => {  // Document order: a, b, c — tops as getBoundingClientRect().top while scrolling
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

describe("zoom 下的坐标换算", () => {
  it("effectiveZoom 无 DOM 时退回 1", () => {
    expect(effectiveZoom(null)).toBe(1);
    expect(effectiveZoom(undefined)).toBe(1);
    // 测试里的假元素、以及已卸载的节点：getComputedStyle 会抛，不能把跳转带崩。
    expect(effectiveZoom({} as Element)).toBe(1);
  });

  it("zoom = 1 时退化成原来那套算法", () => {
    // contentTop = 500，spy 阈值 120 → 380
    expect(scrollTopForViewportDelta(200, 300, 1, 120)).toBe(380);
  });

  it("zoom = 1.3 时把屏幕像素差值乘回容器像素", () => {
    // 视口里标题在下方 300px（屏幕像素），容器自身是 1.3 倍缩放，
    // 所以真实内容是 300 × 1.3 = 390 容器像素。
    expect(scrollTopForViewportDelta(200, 300, 1.3, 0)).toBe(590);
    // 乘 1.3 的结果必须大于不乘：这是修 bug 的核心方向，别写反了。
    expect(scrollTopForViewportDelta(200, 300, 1.3, 0)).toBeGreaterThan(
      scrollTopForViewportDelta(200, 300, 1, 0)
    );
  });

  it("已经滚过目标时钳成 0，不会给出负 scrollTop", () => {
    expect(scrollTopForViewportDelta(0, -500, 1.3, 80)).toBe(0);
    expect(scrollTopForViewportDelta(0, 10, 1, 80)).toBe(0);
  });

  it("坏 zoom 值退化成 1，而不是算出 NaN / Infinity", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(scrollTopForViewportDelta(100, 200, bad, 0)).toBe(300);
    }
  });

  it("实测公式：滚到目标偏移后，标题恰好落在指定位置", () => {
    // 复刻浏览器里验过的数字：zoom 1.3、标题在视口下方 5892px、目标偏移 80。
    // 应有 scrollTop = 0 + (5892 - 80) × 1.3 = 7555.6
    const next = scrollTopForViewportDelta(0, 5892, 1.3, 80);
    expect(Math.round(next)).toBe(7556);
    // 反推：滚过去之后，视口偏移应该正好是 80
    const deltaAfter = (5892 - next / 1.3) * 1.3;
    expect(Math.round(deltaAfter / 1.3)).toBe(80);
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
