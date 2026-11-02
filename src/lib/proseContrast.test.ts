/**
 * 五套主题下代码块的可读性。
 *
 * 样式表里的 `--code-*` / `--syn-*` 是混色推导出来的，眼睛看着「还行」不代表对比度够。
 * 这里把 globals.css 里的主题块按层叠顺序拼出每套主题的实际取值，算 WCAG 对比度：
 * 正文代码 ≥ 4.5，语法色 ≥ 3.0，行号 ≥ 2.0。改坏哪套纸的主题都会红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mixColor, parseColor, type Rgba } from "./mermaidTheme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const THEMES = ["xuan", "bamboo", "jiang", "songyan", "cyber"] as const;

/** 一条主题块：选择器列表 + 其中的自定义属性。 */
type Block = { selectors: string[]; vars: Map<string, string> };

function parseBlocks(source: string): Block[] {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const selectors = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const vars = new Map<string, string>();
    for (const decl of m[2].split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const name = decl.slice(0, at).trim();
      if (!name.startsWith("--")) continue;
      vars.set(name, decl.slice(at + 1).trim());
    }
    if (vars.size) blocks.push({ selectors, vars });
  }
  return blocks;
}

const blocks = parseBlocks(css);

/** 这套主题实际生效的 token（按文件顺序层叠，后者覆盖前者）。 */
function tokensFor(theme: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of blocks) {
    const matches = block.selectors.some(
      (sel) =>
        sel === ":root" ||
        sel === `html[data-theme="${theme}"]` ||
        // 旧版 .dark（无 data-theme）就是松烟
        (theme === "songyan" && sel === "html.dark:not([data-theme])")
    );
    if (!matches) continue;
    for (const [k, v] of block.vars) out.set(k, v);
  }
  return out;
}

/** 把 `var(--x)` / `color-mix(in srgb, var(--a) 88%, var(--b) 6%)` 这类值算成颜色。 */
function resolve(name: string, tokens: Map<string, string>, depth = 0): Rgba | null {
  const raw = tokens.get(name);
  if (!raw || depth > 6) return null;
  const mix =
    /color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s*([\d.]+)%,\s*(var\((--[\w-]+)\)|transparent)\s*(?:([\d.]+)%)?\s*\)/.exec(
      raw
    );
  if (mix) {
    const first = resolve(mix[1], tokens, depth + 1);
    const second =
      mix[3] === "transparent" ? { r: 0, g: 0, b: 0, a: 0 } : resolve(mix[4], tokens, depth + 1);
    if (!first || !second) return null;
    const wFirst = parseFloat(mix[2]);
    // 省略权重时按 CSS 规则取 100% - 另一个
    const wSecond = mix[5] === undefined ? Math.max(0, 100 - wFirst) : parseFloat(mix[5]);
    const total = wFirst + wSecond;
    if (!total) return null;
    const w = wSecond / total;
    const mixNum = (a: number, b: number) => a * (1 - w) + b * w;
    return {
      r: mixNum(first.r, second.r),
      g: mixNum(first.g, second.g),
      b: mixNum(first.b, second.b),
      a: mixNum(first.a, second.a),
    };
  }
  const inner = /^var\((--[\w-]+)\)$/.exec(raw);
  if (inner) return resolve(inner[1], tokens, depth + 1);
  return parseColor(raw);
}

/** 半透明前景压到底色上之后的实际颜色。 */
function over(fg: Rgba, bg: Rgba): Rgba {
  const alpha = fg.a + bg.a * (1 - fg.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 1 };
  const ch = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / alpha;
  return { r: ch(fg.r, bg.r), g: ch(fg.g, bg.g), b: ch(fg.b, bg.b), a: 1 };
}

function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const SYN_TOKENS = [
  "--syn-keyword",
  "--syn-title",
  "--syn-constant",
  "--syn-string",
  "--syn-builtin",
  "--syn-comment",
  "--syn-name",
  "--syn-bullet",
];

for (const theme of THEMES) {
  describe(`主题 ${theme}`, () => {
    const tokens = tokensFor(theme);
    const codeBg = resolve("--code-bg", tokens);
    const codeFg = resolve("--code-fg", tokens);
    const gutterBg = resolve("--code-gutter-bg", tokens);
    const gutterFg = resolve("--code-gutter-fg", tokens);

    it("token 都在（--code-* 由混色派生）", () => {
      expect(codeBg, "--code-bg").not.toBeNull();
      expect(codeFg, "--code-fg").not.toBeNull();
      expect(gutterBg, "--code-gutter-bg").not.toBeNull();
      expect(gutterFg, "--code-gutter-fg").not.toBeNull();
    });

    it("代码正文对比度 ≥ 4.5", () => {
      expect(codeBg && codeFg).toBeTruthy();
      const ratio = contrast(over(codeFg!, codeBg!), codeBg!);
      expect(ratio, `code-fg on code-bg = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });

    it("八个语法色在代码底上各自 ≥ 3", () => {
      for (const name of SYN_TOKENS) {
        const color = resolve(name, tokens);
        expect(color, name).not.toBeNull();
        const ratio = contrast(over(color!, codeBg!), codeBg!);
        expect(ratio, `${name} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    });

    it("行号看得见但不抢戏（≥ 2）", () => {
      expect(gutterBg && gutterFg).toBeTruthy();
      const ratio = contrast(over(gutterFg!, gutterBg!), gutterBg!);
      expect(ratio, `gutter = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(2);
    });

    it("代码块和纸面能分开（底与页面底至少差一点）", () => {
      const bg = resolve("--bg", tokens);
      expect(bg).not.toBeNull();
      const delta =
        Math.abs((codeBg!.r + codeBg!.g + codeBg!.b) / 3 - (bg!.r + bg!.g + bg!.b) / 3);
      expect(delta, `code-bg 与 bg 的平均通道差 = ${delta.toFixed(1)}`).toBeGreaterThanOrEqual(3);
    });
  });
}

describe("混色工具本身", () => {
  it("mixColor 与测试里手算的混色一致（同一套公式）", () => {
    expect(mixColor("#faf8f3", "#3d6b7a", 0.16)).toBe("rgb(220, 225, 224)");
  });
});
