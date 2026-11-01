import { describe, expect, it } from "vitest";
import {
  NO_DIRECT_BINDING_HINT,
  buildInlineScriptIndexes,
  buildJsIndex,
  elementLabel,
  extractInlineScripts,
  jsIndexId,
  jsIndexPath,
  matchSelectorToElement,
  normalizeQuerySelector,
  parseCompoundSelector,
  parseJsIndex,
  resolveBehaviorHits,
  type JsFileIndex,
  type JsFunctionEntry,
} from "./jsIndex";

const FILE = "demo/js/app.js";

/** 行号都在注释里标了，改夹具时一起改。 */
const FIXTURE = [
  /*  1 */ "/* 行为定位单测夹具 */",
  /*  2 */ 'const btn = document.getElementById("btn");',
  /*  3 */ "",
  /*  4 */ "function onSaveClick(event) {",
  /*  5 */ "  event.preventDefault();",
  /*  6 */ "  saveAll();",
  /*  7 */ "}",
  /*  8 */ "",
  /*  9 */ 'btn.addEventListener("click", onSaveClick);',
  /* 10 */ "",
  /* 11 */ 'document.getElementById("list").addEventListener("click", function onListClick(e) {',
  /* 12 */ '  const row = e.target.closest("li");',
  /* 13 */ '  if (row) row.classList.add("done");',
  /* 14 */ "});",
  /* 15 */ "",
  /* 16 */ 'document.addEventListener("keydown", onSaveClick);',
  /* 17 */ "",
  /* 18 */ 'const cards = document.querySelectorAll(".card");',
  /* 19 */ 'cards.forEach(function (card) { card.addEventListener("mouseenter", function () {}); });',
  /* 20 */ "",
  /* 21 */ 'document.querySelector("#wrap > .item").addEventListener("click", () => {});',
  /* 22 */ "",
  /* 23 */ "const api = {",
  /* 24 */ "  load: function () {",
  /* 25 */ '    return fetch("/x");',
  /* 26 */ "  },",
  /* 27 */ "};",
  /* 28 */ "",
  /* 29 */ "class Drawer {",
  /* 30 */ "  open() {",
  /* 31 */ '    this.el.addEventListener("click", () => {});',
  /* 32 */ "  }",
  /* 33 */ "}",
].join("\n");

async function fixtureIndex(): Promise<JsFileIndex> {
  return buildJsIndex(FILE, FIXTURE);
}

function fn(list: JsFunctionEntry[], name: string): JsFunctionEntry | undefined {
  return list.find((f) => f.name === name);
}

describe("buildJsIndex · 函数起止行", () => {
  it("函数声明 / 内联具名函数表达式 / 对象方法 / class 方法", async () => {
    const index = await fixtureIndex();
    expect(fn(index.functions, "onSaveClick")).toEqual({
      name: "onSaveClick",
      kind: "declaration",
      startLine: 4,
      endLine: 7,
    });
    expect(fn(index.functions, "onListClick")).toEqual({
      name: "onListClick",
      kind: "expression",
      startLine: 11,
      endLine: 14,
    });
    expect(fn(index.functions, "load")).toEqual({
      name: "load",
      kind: "method",
      startLine: 24,
      endLine: 26,
    });
    expect(fn(index.functions, "open")).toEqual({
      name: "open",
      kind: "method",
      startLine: 30,
      endLine: 32,
    });
  });

  it("匿名函数不进函数表（但 handler 自己的行号照样记）", async () => {
    const index = await fixtureIndex();
    // 21 行的箭头函数没有名字
    expect(index.functions.some((f) => f.startLine === 21)).toBe(false);
    const binding = index.bindings.find((b) => b.startLine === 21);
    expect(binding?.handlerName).toBe("");
    expect(binding?.handlerStartLine).toBe(21);
    expect(binding?.handlerEndLine).toBe(21);
  });

  it("箭头函数赋值给变量时用变量名", async () => {
    const index = await buildJsIndex("a.js", "const boom = () => {\n  return 1;\n};\n");
    expect(fn(index.functions, "boom")).toEqual({
      name: "boom",
      kind: "arrow",
      startLine: 1,
      endLine: 3,
    });
  });
});

describe("buildJsIndex · DOM 查询（b 类符号）", () => {
  it("四个 API 归一成选择器 + 行号", async () => {
    const index = await fixtureIndex();
    const byLine = new Map(index.queries.map((q) => [q.startLine, q]));
    expect(byLine.get(2)?.selector).toBe("#btn");
    expect(byLine.get(2)?.api).toBe("getElementById");
    expect(byLine.get(11)?.selector).toBe("#list");
    expect(byLine.get(18)?.selector).toBe(".card");
    expect(byLine.get(18)?.api).toBe("querySelectorAll");
    expect(byLine.get(21)?.selector).toBe("#wrap > .item");
  });

  it("getElementsByClassName 的多个 class 拼成复合选择器", () => {
    expect(normalizeQuerySelector("getElementsByClassName", "a b")).toBe(".a.b");
    expect(normalizeQuerySelector("getElementById", " btn ")).toBe("#btn");
    expect(normalizeQuerySelector("querySelector", " .x ")).toBe(".x");
  });
});

describe("buildJsIndex · 事件绑定（c 类符号）", () => {
  it("getElementById(...).addEventListener 直接带选择器", async () => {
    const index = await fixtureIndex();
    const binding = index.bindings.find((b) => b.startLine === 11);
    expect(binding).toMatchObject({
      event: "click",
      selector: "#list",
      handlerName: "onListClick",
      delegated: false,
    });
  });

  it("变量间接绑定能被解析回 #btn", async () => {
    const index = await fixtureIndex();
    const binding = index.bindings.find((b) => b.startLine === 9);
    expect(binding).toMatchObject({
      event: "click",
      selector: "#btn",
      handlerName: "onSaveClick",
      handlerStartLine: 4,
      handlerEndLine: 7,
      delegated: false,
    });
  });

  it("document / window 上的监听标成 delegated（可能是事件委托）", async () => {
    const index = await fixtureIndex();
    const binding = index.bindings.find((b) => b.startLine === 16);
    expect(binding).toMatchObject({ event: "keydown", delegated: true, selector: "" });
  });

  it("归属不明的绑定（forEach 参数 / this.el）不瞎猜：selector 留空", async () => {
    const index = await fixtureIndex();
    const lines = index.bindings.map((b) => b.startLine);
    expect(lines).toContain(19);
    expect(lines).toContain(31);
    expect(index.bindings.find((b) => b.startLine === 19)?.selector).toBe("");
    expect(index.bindings.find((b) => b.startLine === 31)?.selector).toBe("");
  });
});

describe("简单选择器匹配", () => {
  it("#id / .class / tag / 复合", () => {
    expect(matchSelectorToElement("#btn", { tag: "button", id: "btn" }).matched).toBe(true);
    expect(matchSelectorToElement(".card", { tag: "div", classes: ["card"] }).matched).toBe(
      true
    );
    expect(matchSelectorToElement("button", { tag: "BUTTON" }).matched).toBe(true);
    expect(
      matchSelectorToElement("div#x.y", { tag: "div", id: "x", classes: ["y", "z"] }).matched
    ).toBe(true);
  });

  it("少一个 class 就不算命中", () => {
    expect(matchSelectorToElement(".a.b", { tag: "div", classes: ["a"] }).matched).toBe(false);
    expect(matchSelectorToElement(".a.b", { tag: "div", classes: ["a", "b"] }).matched).toBe(
      true
    );
  });

  it("逗号列表任意一段命中即可", () => {
    expect(matchSelectorToElement(".nope, #btn", { tag: "button", id: "btn" }).matched).toBe(
      true
    );
  });

  it("伪类被剥掉，但标成推断", () => {
    const match = matchSelectorToElement("#btn:hover", { tag: "button", id: "btn" });
    expect(match.matched).toBe(true);
    expect(match.approximate).toBe(true);
  });

  it("组合选择器只按末尾复合选择器判，并标 inferred", () => {
    const match = matchSelectorToElement("#wrap > .item", {
      tag: "li",
      classes: ["item"],
    });
    expect(match.matched).toBe(true);
    expect(match.approximate).toBe(true);
    expect(match.onAncestor).toBe(false);
  });

  it("只命中祖先时给 onAncestor + via（事件委托的静态痕迹）", () => {
    const match = matchSelectorToElement("#list", {
      tag: "li",
      ancestors: [{ tag: "ul", id: "list" }],
    });
    expect(match.matched).toBe(true);
    expect(match.onAncestor).toBe(true);
    expect(match.via?.id).toBe("list");
  });

  it("属性选择器判不了 → unsupported，不硬说命中", () => {
    const match = matchSelectorToElement('[data-role="x"]', { tag: "div" });
    expect(match.matched).toBe(false);
    expect(match.unsupported).toBe(true);
  });

  it("通配 * 不参与（命中所有元素等于没信息）", () => {
    expect(matchSelectorToElement("*", { tag: "div" }).matched).toBe(false);
  });

  it("parseCompoundSelector 只认 tag/#id/.class", () => {
    expect(parseCompoundSelector("div#a.b.c")).toEqual({
      tag: "div",
      id: "a",
      classes: ["b", "c"],
      ok: true,
    });
    expect(parseCompoundSelector("*").ok).toBe(false);
    expect(parseCompoundSelector("[hidden]").ok).toBe(false);
  });
});

describe("resolveBehaviorHits · 反查", () => {
  it("点 #btn → click / onSaveClick / app.js:9，整块高亮 4–7", async () => {
    const index = await fixtureIndex();
    const resolved = resolveBehaviorHits({ tag: "button", id: "btn" }, [index]);
    const hit = resolved.hits.find((h) => h.match === "self");
    expect(hit).toBeDefined();
    expect(hit).toMatchObject({
      file: FILE,
      startLine: 9,
      highlightStart: 4,
      highlightEnd: 7,
      event: "click",
      handlerName: "onSaveClick",
      precision: "exact",
    });
    expect(resolved.hint).toBe("");
  });

  it("点子元素、绑定在父元素上 → ancestor 命中 + 委托提示", async () => {
    const index = await fixtureIndex();
    const resolved = resolveBehaviorHits(
      { tag: "li", classes: ["row"], ancestors: [{ tag: "ul", id: "list" }] },
      [index]
    );
    expect(resolved.hits).toHaveLength(1);
    expect(resolved.hits[0]).toMatchObject({
      event: "click",
      selector: "#list",
      handlerName: "onListClick",
      match: "ancestor",
      precision: "fuzzy",
    });
    expect(resolved.hits[0].note).toContain("#list");
    expect(resolved.hits[0].note).toContain("委托");
  });

  it("完全没有绑定 → hint 用验收原话，并把 document 级监听单列", async () => {
    const index = await fixtureIndex();
    const resolved = resolveBehaviorHits({ tag: "footer" }, [index]);
    expect(resolved.hits).toHaveLength(0);
    expect(resolved.hint).toBe(NO_DIRECT_BINDING_HINT);
    expect(resolved.delegated.map((h) => h.event)).toContain("keydown");
    expect(resolved.delegated[0].selector).toBe("document");
  });

  it("一个元素命中多条时全部返回（多个文件）", async () => {
    const a = await buildJsIndex("a.js", 'document.getElementById("btn").addEventListener("click", fa);');
    const b = await buildJsIndex(
      "js/b.js",
      'const x = document.getElementById("btn");\nx.addEventListener("mouseenter", fb);'
    );
    const resolved = resolveBehaviorHits({ tag: "button", id: "btn" }, [a, b]);
    expect(resolved.hits.map((h) => h.event)).toEqual(["click", "mouseenter"]);
    expect(new Set(resolved.hits.map((h) => h.file))).toEqual(new Set(["a.js", "js/b.js"]));
  });

  it("只有查询没有绑定 → hits 为空，但给出相关查询", async () => {
    const index = await buildJsIndex("only.js", 'const btn = document.getElementById("btn");\nbtn.textContent = "hi";\n');
    const resolved = resolveBehaviorHits({ tag: "button", id: "btn" }, [index]);
    expect(resolved.hits).toHaveLength(0);
    expect(resolved.hint).toBe(NO_DIRECT_BINDING_HINT);
    expect(resolved.queries[0]).toMatchObject({ file: "only.js", startLine: 1, api: "getElementById" });
  });

  it("归属不明的绑定计入 unresolved，不当成命中", async () => {
    const index = await buildJsIndex(
      "loose.js",
      'document.querySelectorAll(".card").forEach(function (card) {\n  card.addEventListener("click", fn);\n});\n'
    );
    const resolved = resolveBehaviorHits({ tag: "div", classes: ["card"] }, [index]);
    expect(resolved.hits).toHaveLength(0);
    expect(resolved.unresolved).toBe(1);
  });

  it("解析失败的文件不产出任何符号，只留 parseError", async () => {
    const index = await buildJsIndex("bad.js", "export const = 1;");
    expect(index.parseError).toBeTruthy();
    expect(index.functions).toHaveLength(0);
    expect(index.queries).toHaveLength(0);
    expect(index.bindings).toHaveLength(0);
    // 面板要能把「解析失败」说出来，而不是默默说「未找到」
    const resolved = resolveBehaviorHits({ tag: "div" }, [index]);
    expect(resolved.problems[0]).toContain("bad.js");
    expect(resolved.problems[0]).toContain("解析失败");
  });

  it("模块语法（import/export）也能解析", async () => {
    const index = await buildJsIndex(
      "m.js",
      'import x from "./x.js";\nexport function go() {\n  document.getElementById("go").addEventListener("click", go);\n}\n'
    );
    expect(index.parseError).toBeUndefined();
    expect(index.bindings[0]).toMatchObject({ selector: "#go", handlerName: "go" });
  });
});

describe("内联 <script>", () => {
  const HTML = [
    /* 1 */ "<!doctype html>",
    /* 2 */ "<html>",
    /* 3 */ "<head>",
    /* 4 */ "<script>",
    /* 5 */ '  document.getElementById("inline-btn").addEventListener("click", () => {});',
    /* 6 */ "</script>",
    /* 7 */ '<script type="application/json">{"a":1}</script>',
    /* 8 */ '<script src="js/app.js"></script>',
    /* 9 */ "</head>",
    /*10 */ '<body><button id="inline-btn">x</button></body>',
    /*11 */ "</html>",
  ].join("\n");

  it("只收 JS 内联脚本，跳过 src / 非 JS type / 桥接脚本", () => {
    const blocks = extractInlineScripts(HTML);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startLine).toBe(4);
    expect(blocks[0].code).toContain("inline-btn");
  });

  it("行号偏移到宿主 HTML 的真实行", async () => {
    const indexes = await buildInlineScriptIndexes("demo/index.html", HTML);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].inline).toBe(true);
    expect(indexes[0].bindings[0]).toMatchObject({ event: "click", selector: "#inline-btn", startLine: 5 });
  });

  it("反查能直接给出 HTML 文件的行号", async () => {
    const indexes = await buildInlineScriptIndexes("demo/index.html", HTML);
    const resolved = resolveBehaviorHits({ tag: "button", id: "inline-btn" }, indexes);
    expect(resolved.hits[0]).toMatchObject({
      file: "demo/index.html",
      startLine: 5,
      inline: true,
    });
  });

  it("我们自己注入的桥接脚本不算用户代码", () => {
    const withBridge = `${HTML}\n<script data-lh-bridge="1">void 0;</script>`;
    const blocks = extractInlineScripts(withBridge);
    expect(blocks).toHaveLength(1);
  });
});

describe("索引文件路径与形状校验", () => {
  it("索引落在 content/.langhuan/index/js/<hash>.json", () => {
    expect(jsIndexPath(FILE)).toMatch(/^\.langhuan\/index\/js\/[0-9a-f]{8}\.json$/);
    expect(jsIndexId(FILE)).toBe(jsIndexId("demo\\js\\app.js"));
    expect(jsIndexId(FILE)).not.toBe(jsIndexId("demo/js/other.js"));
  });

  it("parseJsIndex 丢掉坏条目、保留好条目", () => {
    const parsed = parseJsIndex({
      file: "a.js",
      hash: "x",
      functions: [{ name: "go", kind: "declaration", startLine: 1, endLine: 3 }, { name: "" }],
      queries: [{ api: "nope", selector: ".x", startLine: 2 }],
      bindings: [{ event: "click", startLine: 4, selector: "#a", ownerText: "", handlerName: "go" }],
    });
    expect(parsed?.functions).toHaveLength(1);
    expect(parsed?.queries).toHaveLength(0);
    expect(parsed?.bindings).toHaveLength(1);
    expect(parsed?.bindings[0].delegated).toBe(false);
  });

  it("空符号表的索引整体丢掉（不占内存）", () => {
    expect(parseJsIndex({ file: "a.js", functions: [], queries: [], bindings: [] })).toBeNull();
    expect(parseJsIndex(null)).toBeNull();
    expect(parseJsIndex({ file: "" })).toBeNull();
  });

  it("elementLabel 给面板用", () => {
    expect(elementLabel({ tag: "BUTTON", id: "btn", classes: ["a", "b"] })).toBe(
      "button#btn.a.b"
    );
    expect(elementLabel(null)).toBe("");
  });
});
