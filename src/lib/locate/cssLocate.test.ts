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
  parseCssIndex,
  resolveCssHits,
  ruleSignature,
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

  it("ruleSignature：选择器规整 + 条件签名（bridge 与索引共用的身份）", () => {
    expect(ruleSignature(".a  >  .b", ["@media (max-width: 520px)"])).toBe(
      ".a>.b|@media(max-width:520px)"
    );
    expect(ruleSignature(".a", [])).toBe(".a|");
    expect(ruleSignature(" .a ", null)).toBe(".a|");
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

/* ---------------- 同一选择器重复出现 ---------------- */

/** 同条件重复 + @media 内外重复 + @media 内自己重复。 */
const DUP = `.card { color: red; }
.card { color: blue; }
@media (max-width: 520px) {
  .card { color: green; }
  .card { color: teal; }
}
`;

describe("同一选择器重复出现：occurrence 对齐", () => {
  async function dupIndex(): Promise<CssFileIndex> {
    return buildCssIndex("dup.css", DUP);
  }

  it("索引给「选择器 + @条件」相同的规则标 0/1/2…，@media 内自己从 0 起", async () => {
    const index = await dupIndex();
    expect(index.rules.map((r) => [r.selector, r.startLine, r.atRules.length, r.occurrence])).toEqual([
      [".card", 1, 0, 0],
      [".card", 2, 0, 1],
      [".card", 4, 1, 0],
      [".card", 5, 1, 1],
    ]);
  });

  it("按 occurrence 取候选：同条件下第二条落到第 2 行，不再永远是第一条", async () => {
    const index = await dupIndex();
    const hits = resolveCssHits(
      [
        { selector: ".card", file: "dup.css", conditions: [], occurrence: 0, order: 0 },
        { selector: ".card", file: "dup.css", conditions: [], occurrence: 1, order: 1 },
      ],
      [index]
    );
    expect(hits.map((h) => [h.startLine, h.precision])).toEqual([
      [2, "exact"],
      [1, "exact"],
    ]);
    expect(hits.every((h) => h.message.includes("已定位到第"))).toBe(true);
  });

  it("occurrence 是「同签名」内计数：@media 内外的同名规则各数各的", async () => {
    const index = await dupIndex();
    const hits = resolveCssHits(
      [
        { selector: ".card", file: "dup.css", conditions: [], occurrence: 1, order: 0 },
        {
          selector: ".card",
          file: "dup.css",
          conditions: ["@media (max-width: 520px)"],
          occurrence: 1,
          order: 1,
        },
      ],
      [index]
    );
    const top = hits.find((h) => h.atRules.length === 0)!;
    const media = hits.find((h) => h.atRules.length > 0)!;
    expect([top.startLine, top.endLine]).toEqual([2, 2]);
    expect([media.startLine, media.endLine]).toEqual([5, 5]);
    expect(media.atRules).toEqual(["@media (max-width: 520px)"]);
    expect(hits.every((h) => h.precision === "exact")).toBe(true);
  });

  it("序号超出索引（运行时又插了一份）→ fuzzy，且不给行号", async () => {
    const index = await dupIndex();
    const hits = resolveCssHits(
      [{ selector: ".card", file: "dup.css", conditions: [], occurrence: 2, order: 0 }],
      [index]
    );
    expect(hits[0]).toMatchObject({ startLine: 0, endLine: 0, precision: "fuzzy" });
    expect(hits[0].message).toContain("无法唯一对应");
  });

  it("有重复但没有序号（老 bridge）→ fuzzy + 说明，不跳到第一条", async () => {
    const index = await dupIndex();
    const hits = resolveCssHits(
      [{ selector: ".card", file: "dup.css", conditions: [], order: 0 }],
      [index]
    );
    expect(hits[0].precision).toBe("fuzzy");
    expect(hits[0].startLine).toBe(0);
    expect(hits[0].message).toContain("存在多条同名规则");
    expect(hits[0].message).toContain("无法唯一对应");
  });

  it("只有一条候选又没有序号（老 bridge）→ 仍然 exact", async () => {
    const index = await dupIndex();
    const hits = resolveCssHits(
      [{ selector: ".card", file: "dup.css", conditions: ["@media print"], order: 0 }],
      [index]
    );
    // 条件对不上 → 按条件层数退到 @media 内第一条，标 fuzzy（不是 exact）
    expect(hits[0].precision).toBe("fuzzy");
    expect(hits[0].startLine).toBe(4);

    const single = await buildCssIndex("one.css", ".only { color: red; }\n");
    const ok = resolveCssHits([{ selector: ".only", file: "one.css" }], [single]);
    expect(ok[0]).toMatchObject({ precision: "exact", startLine: 1 });
  });

  it("旧索引（JSON 里没有 occurrence）读入时按位置重算，跳转仍然正确", async () => {
    const index = await dupIndex();
    // 模拟老索引：丢掉 occurrence 字段
    const legacyJson = {
      file: index.file,
      hash: index.hash,
      rules: index.rules.map(({ occurrence, ...rest }) => {
        void occurrence;
        return rest;
      }),
    };
    const legacy = parseCssIndex(JSON.parse(JSON.stringify(legacyJson)))!;
    expect(legacy.rules.map((r) => r.occurrence)).toEqual([0, 1, 0, 1]);
    const hits = resolveCssHits(
      [{ selector: ".card", file: "dup.css", conditions: [], occurrence: 1 }],
      [legacy]
    );
    expect(hits[0]).toMatchObject({ startLine: 2, precision: "exact" });
  });
});

/* ---------------- 逗号列表：按命中分支算特异性 ---------------- */

const LIST = `#id, .card { border: 1px solid; }
.card { padding: 8px; }
.card.wide { width: 100%; }
`;

describe("逗号选择器列表：用命中分支算 specificity", () => {
  it("只命中 .card 分支时，(0,1,0) 而不是整列的 (1,0,0)", async () => {
    const index = await buildCssIndex("list.css", LIST);
    const rule = index.rules[0];
    // 索引里记的是静态的整列最大值（列表整体），只作兜底
    expect(rule.specificity).toEqual([1, 0, 0]);

    const hits = resolveCssHits(
      [
        {
          selector: "#id, .card",
          file: "list.css",
          conditions: [],
          specificity: [0, 1, 0],
          matchedBranches: [".card"],
          order: 1,
        },
      ],
      [index]
    );
    expect(hits[0].specificity).toEqual([0, 1, 0]);
    expect(hits[0].matchedBranches).toEqual([".card"]);
    // 展示用完整选择器
    expect(hits[0].selector).toBe("#id, .card");
    expect(hits[0].precision).toBe("exact");
  });

  it("多分支同时命中：取命中分支里最高的（等价于多条独立规则）", async () => {
    const index = await buildCssIndex("list.css", LIST);
    const hits = resolveCssHits(
      [
        {
          selector: "#id, .card",
          file: "list.css",
          specificity: [1, 0, 0],
          order: 0,
        },
      ],
      [index]
    );
    expect(hits[0].specificity).toEqual([1, 0, 0]);
    // 整列都命中 → 没有「只命中一部分」可标
    expect(hits[0].matchedBranches).toBeUndefined();
  });

  it("排序用命中分支的特异性：.card.wide (0,2,0) 应该压过 #id, .card 的 .card 分支", async () => {
    const index = await buildCssIndex("list.css", LIST);
    const hits = resolveCssHits(
      [
        {
          selector: "#id, .card",
          file: "list.css",
          specificity: [0, 1, 0],
          matchedBranches: [".card"],
          order: 1,
        },
        { selector: ".card.wide", file: "list.css", specificity: [0, 2, 0], order: 0 },
        { selector: ".card", file: "list.css", specificity: [0, 1, 0], order: 0 },
      ],
      [index]
    );
    expect(hits.map((h) => h.selector)).toEqual([".card.wide", "#id, .card", ".card"]);
  });

  it("旧 bridge 只给选择器（没有命中分支）→ 退回整列最大值", async () => {
    const index = await buildCssIndex("list.css", LIST);
    const hits = resolveCssHits([{ selector: "#id, .card", file: "list.css" }], [index]);
    expect(hits[0].specificity).toEqual([1, 0, 0]);
    expect(hits[0].matchedBranches).toBeUndefined();
  });

  it("bridge 报的分支必须真的在这条选择器里，否则丢弃", async () => {
    const index = await buildCssIndex("list.css", LIST);
    const hits = resolveCssHits(
      [
        {
          selector: "#id, .card",
          file: "list.css",
          specificity: [0, 1, 0],
          matchedBranches: [".not-in-list"],
        },
      ],
      [index]
    );
    expect(hits[0].matchedBranches).toBeUndefined();
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
