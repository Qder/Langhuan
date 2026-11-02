/**
 * Mermaid 配色：从主题 token 翻译成 mermaid 的 themeVariables。
 *
 * 关键是「跟着主题走」而不是自带一套深色皮：浅色主题 darkMode=false、
 * 底色是纸色；深色主题 darkMode=true。颜色值必须是 mermaid 能写进 SVG 的 rgb()，
 * 所以混色在 JS 里算，不能把 color-mix() 塞给它。
 */
import { describe, expect, it } from "vitest";
import {
  mixColor,
  parseColor,
  themeIsDark,
  themeTokensFrom,
  mermaidThemeVars,
  type ThemeTokens,
} from "./mermaidTheme";

const XUAN: ThemeTokens = {
  bg: "#faf8f3",
  fg: "#2a2620",
  muted: "#7a7468",
  accent: "#3a5080",
  teal: "#3d6b7a",
  gold: "#a87a2c",
  border: "rgba(42, 38, 32, 0.12)",
};

const SONGYAN: ThemeTokens = {
  bg: "#12141a",
  fg: "#e8ecf0",
  muted: "#9aa3ad",
  accent: "#a8b0bc",
  teal: "#8aa0b0",
  gold: "#c4b59a",
  border: "rgba(232, 236, 240, 0.12)",
};

describe("parseColor", () => {
  it("认 #rgb / #rrggbb / rgb() / rgba()", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#12141a")).toEqual({ r: 18, g: 20, b: 26, a: 1 });
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it("怪值返回 null（不猜）", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("var(--fg)")).toBeNull();
    expect(parseColor("oklch(0.7 0.1 200)")).toBeNull();
    expect(parseColor("rgb(1,2)")).toBeNull();
  });
});

describe("mixColor", () => {
  it("0 = 原色，1 = 全部叠加色", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("rgb(0, 0, 0)");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
  });

  it("中间值按比例插值（纸色掺青 16%）", () => {
    // #faf8f3 → (250,248,243)，#3d6b7a → (61,107,122)
    expect(mixColor("#faf8f3", "#3d6b7a", 0.16)).toBe("rgb(220, 225, 224)");
  });

  it("叠加色带 alpha 时保留透明度", () => {
    expect(mixColor("#ffffff", "rgba(0,0,0,0.5)", 0.5)).toBe("rgba(128, 128, 128, 0.75)");
  });

  it("解析不了就原样返回，不产生非法颜色", () => {
    expect(mixColor("var(--bg)", "#fff", 0.5)).toBe("var(--bg)");
  });
});

describe("themeTokensFrom", () => {
  it("按名字取值并 trim", () => {
    const map: Record<string, string> = { "--bg": " #fff ", "--fg": "#111" };
    const tokens = themeTokensFrom((n) => map[n] ?? "");
    expect(tokens.bg).toBe("#fff");
    expect(tokens.fg).toBe("#111");
  });

  it("主题没给值就退回宣纸默认（图总得能画）", () => {
    const tokens = themeTokensFrom(() => "");
    expect(tokens.bg).toBe("#faf8f3");
    expect(tokens.teal).toBeTruthy();
  });
});

describe("mermaidThemeVars", () => {
  it("浅色主题：darkMode=false，底就是纸色", () => {
    const vars = mermaidThemeVars(XUAN, false);
    expect(vars.darkMode).toBe(false);
    expect(vars.background).toBe(XUAN.bg);
    expect(vars.textColor).toBe(XUAN.fg);
    expect(vars.edgeLabelBackground).toBe(XUAN.bg);
  });

  it("深色主题：darkMode=true（跟 data-theme 走，不再永远 true）", () => {
    expect(mermaidThemeVars(SONGYAN, true).darkMode).toBe(true);
    expect(mermaidThemeVars(SONGYAN, true).background).toBe(SONGYAN.bg);
  });

  it("节点是主题色掺纸色，不是写死的终端配色", () => {
    const vars = mermaidThemeVars(XUAN, false);
    expect(String(vars.mainBkg)).toBe(mixColor(XUAN.bg, XUAN.teal, 0.16));
    expect(vars.primaryBorderColor).toBe(XUAN.teal);
    expect(vars.lineColor).toBe(XUAN.gold);
  });

  it("所有颜色值都是 mermaid 写进 SVG 也认的格式（rgb/rgba/原 token）", () => {
    const vars = mermaidThemeVars(XUAN, false);
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value !== "string") continue;
      if (key === "fontFamily") continue;
      expect(value).not.toContain("color-mix");
      expect(value).toMatch(/^(#[0-9a-f]{3,6}|rgba?\(|rgba\()/i);
    }
  });

  it("不含旧的深色砖配色", () => {
    const flat = JSON.stringify(mermaidThemeVars(XUAN, false));
    expect(flat).not.toContain("#1a1814");
    expect(flat).not.toContain("#ece4d2");
  });
});

describe("themeIsDark", () => {
  it("songyan / cyber 是深色，其余浅色", () => {
    expect(themeIsDark("songyan")).toBe(true);
    expect(themeIsDark("cyber")).toBe(true);
    expect(themeIsDark("xuan")).toBe(false);
    expect(themeIsDark("bamboo")).toBe(false);
    expect(themeIsDark("jiang")).toBe(false);
  });

  it("旧主题 id 会先归一化（ink → songyan）", () => {
    expect(themeIsDark("ink")).toBe(true);
    expect(themeIsDark("paper")).toBe(false);
  });
});
