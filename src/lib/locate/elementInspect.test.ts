import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildElementHtmlInfo,
  formatElementLocation,
  formatOpenTag,
  normalizeAttrs,
  precisionLabel,
} from "./elementInspect";
import { locateInHtml } from "./htmlLocate";

const SOURCE = [
  "<!doctype html>",
  '<html><body>',
  '  <h1>行为定位验收</h1>',
  '  <p>',
  '    <button id="btn" class="primary" data-lh="40-80">保存</button>',
  "    — 直接绑定",
  "  </p>",
  "</body></html>",
].join("\n");

/** 源码里某个子串的行号（1-based），测试里当期望值用。 */
function lineOfSubstring(source: string, needle: string): number {
  const at = source.indexOf(needle);
  expect(at).toBeGreaterThanOrEqual(0);
  return source!.slice(0, at).split("\n").length;
}

describe("normalizeAttrs", () => {
  it("丢掉插桩属性、压平空白、超长值截断", () => {
    const attrs = normalizeAttrs([
      { name: "id", value: "btn" },
      { name: "CLASS", value: "primary   big" },
      { name: "data-lh", value: "40-80" },
      { name: "data-lh-node", value: "1" },
      { name: "title", value: `  ${"x".repeat(120)}  ` },
      { name: "empty", value: "" },
    ]);
    expect(attrs.map((a) => a.name)).toEqual(["id", "class", "title", "empty"]);
    expect(attrs[1].value).toBe("primary big");
    expect(attrs[2].value).toHaveLength(81); // 80 + …
    expect(attrs[2].value.endsWith("…")).toBe(true);
    expect(attrs[3].value).toBe("");
  });

  it("脏数据直接丢，不炸", () => {
    expect(normalizeAttrs(null)).toEqual([]);
    expect(normalizeAttrs([null, 1, "x", { name: "" }, { name: 5 }])).toEqual([]);
    expect(normalizeAttrs([{ name: "href" }])).toEqual([{ name: "href", value: "" }]);
  });

  it("最多留 12 个属性（面板宽度有限）", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `a${i}`, value: String(i) }));
    expect(normalizeAttrs(many)).toHaveLength(12);
  });
});

describe("formatOpenTag", () => {
  it("按源码写法拼打开标签，值加引号", () => {
    expect(
      formatOpenTag("button", [
        { name: "id", value: "btn" },
        { name: "class", value: "primary" },
      ])
    ).toBe('<button id="btn" class="primary">');
  });

  it("布尔属性只写名字；超过 maxAttrs 收尾成 … +N", () => {
    const attrs = [
      { name: "disabled", value: "" },
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ];
    expect(formatOpenTag("input", attrs, { maxAttrs: 2 })).toBe(
      '<input disabled a="1" … +1>'
    );
  });

  it("没有属性 / 没有 tag 也不出怪字符串", () => {
    expect(formatOpenTag("div", [])).toBe("<div>");
    expect(formatOpenTag("", [])).toBe("<element>");
  });
});

describe("buildElementHtmlInfo：三段里的 HTML 段", () => {
  const element = {
    tag: "button",
    attrs: [
      { name: "id", value: "btn" },
      { name: "class", value: "primary" },
    ],
  };

  it("有 data-lh 标注区间 → 精确，行号指到元素的源码行", () => {
    const start = SOURCE.indexOf('<button id="btn"');
    const end = SOURCE.indexOf("</button>") + "</button>".length;
    const html = buildElementHtmlInfo({
      file: "验收/index.html",
      source: SOURCE,
      element,
      range: { start, end },
    })!;
    expect(html.precision).toBe("exact");
    expect(html.startLine).toBe(lineOfSubstring(SOURCE, '<button id="btn"'));
    expect(html.endLine).toBe(html.startLine); // 单行元素
    expect(html.tag).toBe("button");
    expect(html.attrs.map((a) => a.name)).toEqual(["id", "class"]);
    expect(html.note).toContain("data-lh");
  });

  it("多行元素 → 行区间覆盖整个标签", () => {
    const multi = ["<div", '  class="card"', ">", "  hi", "</div>"].join("\n");
    const html = buildElementHtmlInfo({
      file: "a.html",
      source: multi,
      element: { tag: "div", attrs: [{ name: "class", value: "card" }] },
      range: { start: 0, end: multi.length },
    })!;
    expect(html.startLine).toBe(1);
    expect(html.endLine).toBe(5);
    expect(formatElementLocation(html.file, html.startLine, html.endLine)).toBe("a.html:1–5");
  });

  it("没有标注时用 htmlLocate 的结果：按文本命中 → 精确到那一行", () => {
    const located = locateInHtml({ source: SOURCE, text: "保存" });
    expect(located.precision).not.toBe("none");
    const html = buildElementHtmlInfo({
      file: "验收/index.html",
      source: SOURCE,
      element,
      located,
    })!;
    expect(html.startLine).toBe(lineOfSubstring(SOURCE, '<button id="btn"'));
    expect(html.endLine).toBe(html.startLine);
    expect(["exact", "fuzzy", "block"]).toContain(html.precision);
    expect(html.note).toContain("文本");
  });

  it("命中的是近似位置 → 保留推断精度，不装精确", () => {
    const at = SOURCE.indexOf("<h1>");
    const html = buildElementHtmlInfo({
      file: "a.html",
      source: SOURCE,
      element,
      located: { start: at, end: at + 20, precision: "container", message: "容器近似" },
    })!;
    expect(html.precision).toBe("container");
    expect(precisionLabel(html.precision)).toBe("推断");
    expect(html.startLine).toBe(lineOfSubstring(SOURCE, "<h1>"));
  });

  it("定位不到 → 明说没定位，不给行号", () => {
    const html = buildElementHtmlInfo({
      file: "a.html",
      source: SOURCE,
      element,
      located: { start: 0, end: 0, precision: "none", message: "没找到" },
    })!;
    expect(html.precision).toBe("none");
    expect(html.startLine).toBe(0);
    expect(html.endLine).toBe(0);
    expect(html.note).toContain("没定位到");
    expect(formatElementLocation(html.file, html.startLine, html.endLine)).toBe("");
  });

  it("没有元素身份时返回 null（抽屉会显示「没拿到位置」）", () => {
    expect(
      buildElementHtmlInfo({ file: "a.html", source: SOURCE, element: null })
    ).toBeNull();
  });
});

describe("示例项目：点 #btn 时 HTML 段指向真实的 index.html 行", () => {
  const html = readFileSync("examples/行为定位验收/index.html", "utf8");

  it("<button id=\"btn\"> 在 index.html 的那一行", () => {
    const start = html.indexOf('<button id="btn"');
    const end = html.indexOf("</button>", start) + "</button>".length;
    const info = buildElementHtmlInfo({
      file: "行为定位验收/index.html",
      source: html,
      element: { tag: "button", attrs: [{ name: "id", value: "btn" }] },
      range: { start, end },
    })!;
    expect(info.startLine).toBe(lineOfSubstring(html, '<button id="btn"'));
    const lines = html.split(/\r?\n/);
    expect(lines[info.startLine - 1]).toContain('<button id="btn"');
    expect(lines[info.endLine - 1]).toContain("</button>");
  });
});

describe("precisionLabel", () => {
  it("四种精度各有说法", () => {
    expect(precisionLabel("exact")).toBe("精确");
    expect(precisionLabel("fuzzy")).toBe("推断");
    expect(precisionLabel("block")).toBe("推断");
    expect(precisionLabel("container")).toBe("推断");
    expect(precisionLabel("script")).toBe("推断");
    expect(precisionLabel("none")).toBe("未定位");
  });
});
