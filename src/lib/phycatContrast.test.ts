/**
 * 绯猫四套皮的纸 / 墨 / 侧栏对比度。
 * 正文必须用 --fg，不能再掺成 muted；侧栏 chrome 要和纸面能分开。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseColor, type Rgba } from "./mermaidTheme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const prose = readFileSync(new URL("../styles/phycat/prose.css", import.meta.url), "utf8");

const PHYCAT = ["phycat", "phycat-mint", "phycat-sky", "phycat-abyss"] as const;

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

function tokensFor(theme: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of blocks) {
    if (!block.selectors.some((sel) => sel === `html[data-theme="${theme}"]`)) continue;
    for (const [k, v] of block.vars) out.set(k, v);
  }
  return out;
}

function resolve(name: string, tokens: Map<string, string>, depth = 0): Rgba | null {
  const raw = tokens.get(name);
  if (!raw || depth > 6) return null;
  const inner = /^var\((--[\w-]+)\)$/.exec(raw);
  if (inner) return resolve(inner[1], tokens, depth + 1);
  return parseColor(raw);
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

describe("绯猫 prose 不再把正文写成 muted", () => {
  it("段落颜色是 --fg", () => {
    expect(prose).toMatch(
      /html\[data-theme\^="phycat"\] \.prose-langhuan p \{[^}]*color:\s*var\(--fg\)/
    );
  });
  it("深渊不再单开 muted 段落", () => {
    expect(prose).not.toMatch(
      /html\[data-theme="phycat-abyss"\] \.prose-langhuan p \{[^}]*--muted/
    );
  });
});

for (const theme of PHYCAT) {
  describe(`绯猫壳层 ${theme}`, () => {
    const tokens = tokensFor(theme);
    const bg = resolve("--bg", tokens);
    const fg = resolve("--fg", tokens);
    const muted = resolve("--muted", tokens);
    const chrome = resolve("--chrome", tokens);

    it("正文墨色在纸上 ≥ 7", () => {
      expect(bg && fg).toBeTruthy();
      expect(contrast(fg!, bg!), `${theme} fg/bg`).toBeGreaterThanOrEqual(7);
    });

    it("侧栏 muted 在 chrome 上 ≥ 4.5", () => {
      expect(chrome && muted).toBeTruthy();
      expect(contrast(muted!, chrome!), `${theme} muted/chrome`).toBeGreaterThanOrEqual(4.5);
    });

    it("侧栏和纸面能分开", () => {
      expect(bg && chrome).toBeTruthy();
      const delta =
        Math.abs((chrome!.r + chrome!.g + chrome!.b) / 3 - (bg!.r + bg!.g + bg!.b) / 3);
      expect(delta, `${theme} chrome-bg Δ=${delta.toFixed(1)}`).toBeGreaterThanOrEqual(8);
    });
  });
}

describe("浅色绯猫 H2 白字压在深色条上", () => {
  for (const theme of ["phycat", "phycat-mint", "phycat-sky"] as const) {
    it(`${theme} 白字 vs element-deep ≥ 4.5`, () => {
      const tokens = tokensFor(theme);
      const deep = resolve("--phycat-element-deep", tokens);
      const white = parseColor("#ffffff");
      expect(deep && white).toBeTruthy();
      expect(contrast(white!, deep!), theme).toBeGreaterThanOrEqual(4.5);
    });
  }
});
