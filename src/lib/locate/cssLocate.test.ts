import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  atRulesSignature,
  buildCssIndex,
  compareSpecificity,
  cssIndexId,
  cssIndexPath,
  formatSpecificity,
  normalizeSelector,
  resolveCssHits,
  specificityOf,
  specificityScore,
  splitSelectorList,
  type CssFileIndex,
} from "./cssLocate";

const FIXTURE = `:root { --ink: #333; }
body div { border: 1px solid #ccc; }
.card { padding: 16px; }
.card:hover { transform: translateY(-2px); }
@media (max-width: 520px) {
  .card { padding: 10px; }
}
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
`;

const FILE = "demo/css/style.css";

describe("splitSelectorList", () => {
  it("切分逗号列表", () => {
    expect(splitSelectorList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("括号里的逗号不切", () => {
    expect(splitSelectorList(":not(.a, .b), .c")).toEqual([":not(.a, .b)", ".c"]);
    expect(splitSelectorList("[data-x='a,b'], .c")).toEqual(["[data-x='a,b']", ".c"]);
  });

  it("空串与纯逗号", () => {
    expect(splitSelectorList("")).toEqual([]);
    expect(splitSelectorList(" , ")).toEqual([]);
  });
});

describe("specificityOf", () => {
  it("id / class / 类型", () => {
    expect(specificityOf("#app")).toEqual([1, 0, 0]);
    expect(specificityOf(".card")).toEqual([0, 1, 0]);
    expect(specificityOf("div")).toEqual([0, 0, 1]);
    expect(specificityOf("*")).toEqual([0, 0, 0]);
    expect(specificityOf("body div")).toEqual([0, 0, 2]);
    expect(specificityOf("div.card")).toEqual([0, 1, 1]);
  });

  it("属性选择器算 class 级", () => {
    expect(specificityOf("[data-x]")).toEqual([0, 1, 0]);
    expect(specificityOf("[data-x='a,b']")).toEqual([0, 1, 0]);
    expect(specificityOf("a[href^='http']")).toEqual([0, 1, 1]);
  });

  it("伪类算 class 级，伪元素算类型级", () => {
    expect(specificityOf(".card:hover")).toEqual([0, 2, 0]);
    expect(specificityOf("a:visited")).toEqual([0, 1, 1]);
    expect(specificityOf("p::first-line")).toEqual([0, 0, 2]);
    expect(specificityOf("p:before")).toEqual([0, 0, 2]);
    expect(specificityOf("li:nth-child(2n+1)")).toEqual([0, 1, 1]);
  });

  it(":is/:not/:has 取参数最大，:where 恒为 0", () => {
    expect(specificityOf(":is(.a, #b)")).toEqual([1, 0, 0]);
    expect(specificityOf(":not(.a, .b)")).toEqual([0, 1, 0]);
    expect(specificityOf("div:not(#x)")).toEqual([1, 0, 1]);
    expect(specificityOf(":where(#a) .b")).toEqual([0, 1, 0]);
    expect(specificityOf(":has(> img)")).toEqual([0, 0, 1]);
  });

  it("nth-child(of ...) 叠加参数选择器", () => {
    expect(specificityOf("li:nth-child(2 of .hot)")).toEqual([0, 2, 1]);
  });

  it("比较与展示", () => {
    expect(compareSpecificity([0, 2, 0], [0, 1, 3])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 0], [0, 1, 0])).toBe(0);
    expect(specificityScore([0, 1, 0])).toBe(100);
    expect(formatSpecificity([1, 2, 3])).toBe("(1,2,3)");
  });
});

describe("normalizeSelector / atRulesSignature", () => {
  it("折叠空白与组合符两侧", () => {
    expect(normalizeSelector("  body   >  div  ")).toBe("body>div");
    expect(normalizeSelector(".a , .b")).toBe(".a,.b");
  });

  it("@ 条件签名忽略空白与大小写", () => {
    expect(atRulesSignature(["@media (max-width: 520px)"])).toBe(
      atRulesSignature(["@media(max-width:520px)"])
    );
    expect(atRulesSignature([])).toBe("");
    expect(atRulesSignature(null)).toBe("");
  });
});

describe("buildCssIndex", () => {
  it("行号、@media 条件、keyframes 跳过", async () => {
    const index = await buildCssIndex(FILE, FIXTURE);
    expect(index.file).toBe(FILE);
    expect(index.rules.map((r) => [r.selector, r.startLine, r.endLine])).toEqual([
      [":root", 1, 1],
      ["body div", 2, 2],
      [".card", 3, 3],
      [".card:hover", 4, 4],
      [".card", 6, 6],
    ]);
    // @keyframes 内的 from/to 不是元素规则
    expect(index.rules.some((r) => r.selector === "from")).toBe(false);
  });

  it("@media 里的规则记录外层条件，外→内", async () => {
    const index = await buildCssIndex(FILE, FIXTURE);
    const inMedia = index.rules.find((r) => r.startLine === 6)!;
    expect(inMedia.atRules).toEqual(["@media (max-width: 520px)"]);
    expect(index.rules.find((r) => r.startLine === 3)!.atRules).toEqual([]);
  });

  it("声明摘要 + 逗号列表取最大 specificity", async () => {
    const index = await buildCssIndex(FILE, FIXTURE);
    expect(index.rules.find((r) => r.startLine === 3)!.decls).toEqual(["padding: 16px"]);
    const listy = await buildCssIndex("x.css", ".a, #b .c { color: red; }\n");
    expect(listy.rules[0].specificity).toEqual([1, 1, 0]);
  });

  it("嵌套 @supports / @media 的多层条件", async () => {
    const css = `@supports (display: grid) {
  @media screen {
    .grid { display: grid; }
  }
}
`;
    const index = await buildCssIndex("n.css", css);
    expect(index.rules).toHaveLength(1);
    expect(index.rules[0].atRules).toEqual(["@supports (display: grid)", "@media screen"]);
    expect(index.rules[0].startLine).toBe(3);
  });

  it("CRLF 源码行号仍为 1-based", async () => {
    const index = await buildCssIndex("crlf.css", ".a {\r\n  color: red;\r\n}\r\n.b {\r\n  color: blue;\r\n}\r\n");
    expect(index.rules.map((r) => [r.selector, r.startLine, r.endLine])).toEqual([
      [".a", 1, 3],
      [".b", 4, 6],
    ]);
  });
});

describe("索引文件路径", () => {
  it("按文件路径定名，稳定且不同文件不同名", () => {
    expect(cssIndexId(FILE)).toBe(cssIndexId(FILE));
    expect(cssIndexId(FILE)).not.toBe(cssIndexId("other/css/style.css"));
    expect(cssIndexPath(FILE)).toMatch(/^\.langhuan\/index\/css\/[0-9a-f]{8}\.json$/);
  });
});

describe("resolveCssHits", () => {
  async function index(): Promise<CssFileIndex[]> {
    return [await buildCssIndex(FILE, FIXTURE)];
  }

  it("同选择器按 @ 条件区分 @media 内外", async () => {
    const indexes = await index();
    const hits = resolveCssHits(
      [
        { selector: ".card", file: FILE, conditions: [] },
        { selector: ".card", file: FILE, conditions: ["@media(max-width:520px)"] },
      ],
      indexes
    );
    const lines = hits.map((h) => [h.startLine, h.endLine, h.precision]);
    expect(lines).toEqual([
      [6, 6, "exact"],
      [3, 3, "exact"],
    ]);
    expect(hits[0].atRules).toEqual(["@media (max-width: 520px)"]);
  });

  it("排序：specificity 高在前，同 specificity 源码靠后在前", async () => {
    const indexes = await index();
    const hits = resolveCssHits(
      [
        { selector: "body div", file: FILE, conditions: [] },
        { selector: ".card", file: FILE, conditions: [] },
        { selector: ".card:hover", file: FILE, conditions: [] },
      ],
      indexes
    );
    expect(hits.map((h) => h.selector)).toEqual([".card:hover", ".card", "body div"]);
  });

  it("索引里找不到 → fuzzy（动态注入）", async () => {
    const indexes = await index();
    const hits = resolveCssHits(
      [{ selector: ".injected", file: FILE, conditions: [] }, { selector: ".x" }],
      indexes
    );
    expect(hits.every((h) => h.precision === "fuzzy")).toBe(true);
    expect(hits[0].startLine).toBe(0);
    expect(hits[1].message).toContain("动态注入");
    expect(hits.every((h) => h.decls.length === 0)).toBe(true);
  });

  it("文件不在索引里 → fuzzy，保留选择器与 specificity", async () => {
    const hits = resolveCssHits(
      [{ selector: ".a .b", file: "nope.css", conditions: [] }],
      []
    );
    expect(hits[0]).toMatchObject({ file: "nope.css", precision: "fuzzy" });
    expect(hits[0].specificity).toEqual([0, 2, 0]);
  });

  it("条件对不上时给 fuzzy 提示，仍按「同名同层」给行号", async () => {
    const indexes = await index();
    const hits = resolveCssHits(
      [{ selector: ".card", file: FILE, conditions: ["@media print"] }],
      indexes
    );
    // 两条 .card：第 3 行（无条件）与第 6 行（@media 内）。命中带了 1 层条件 → 取 @media 内那条。
    expect(hits[0]).toMatchObject({ startLine: 6, precision: "fuzzy" });
    expect(hits[0].message).toContain("条件");
  });
});

describe("条件当前是否生效（active）", () => {
  it("原样透传 bridge 的 active，缺省视为生效", async () => {
    const index = await buildCssIndex(FILE, FIXTURE);
    const hits = resolveCssHits(
      [
        { selector: ".card", file: FILE, conditions: ["@media (max-width: 520px)"], active: false },
        { selector: "body div", file: FILE },
      ],
      [index]
    );
    const media = hits.find((h) => h.atRules.length > 0)!;
    expect(media.active).toBe(false);
    expect(hits.find((h) => h.selector === "body div")!.active).toBe(true);
  });
});

describe("验收：examples/项目示例 的卡片命中 4 条规则", () => {  const LIB_PATH = "项目示例/css/style.css";
  const diskPath = path.join(process.cwd(), "examples", "项目示例", "css", "style.css");

  it("4 条都能落到正确行，@media 那条标出条件", async () => {
    const css = readFileSync(diskPath, "utf8");
    const index = await buildCssIndex(LIB_PATH, css);
    const hits = resolveCssHits(
      [
        { selector: ".card:hover", file: LIB_PATH, conditions: [] },
        { selector: ".card", file: LIB_PATH, conditions: ["@media (max-width: 520px)"] },
        { selector: ".card", file: LIB_PATH, conditions: [] },
        { selector: "body div", file: LIB_PATH, conditions: [] },
      ],
      [index]
    );

    expect(hits).toHaveLength(4);
    expect(hits.every((h) => h.precision === "exact")).toBe(true);
    // specificity：.card:hover (0,2,0) 最高
    expect(hits[0].selector).toBe(".card:hover");

    const lines = css.split(/\r?\n/);
    for (const h of hits) {
      expect(h.startLine).toBeGreaterThan(0);
      // 首行就是这条规则（选择器所在行），末行收在规则的 } 上
      expect(lines[h.startLine - 1]).toContain(h.selector);
      expect(lines[h.endLine - 1]).toContain("}");
      expect(h.decls.length).toBeGreaterThan(0);
    }

    const media = hits.find((h) => h.atRules.length > 0);
    expect(media).toBeTruthy();
    expect(media!.atRules[0]).toMatch(/^@media/);
    // @media 内那条在源码里确实被 @media 包着：往上能找到 @media 行
    const mediaLine = lines
      .slice(0, media!.startLine)
      .lastIndexOf(lines.slice(0, media!.startLine).find((l) => /^@media/.test(l)) ?? "");
    expect(mediaLine).toBeGreaterThanOrEqual(0);
  });
});
