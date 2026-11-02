/**
 * Mermaid 的配色来源。
 *
 * 以前这里写死了一套深色 `themeVariables`（`darkMode: true` + `#1a1814` 底），
 * 于是宣纸主题上也会渲染出一张深色图 —— 跟周围纸面完全是两张皮。
 *
 * 现在从 `<html>` 上的 CSS 变量读：纸色 / 墨色 / 朱砂 / 青 / 金都是主题自己给的，
 * 这里只负责把它们翻译成 mermaid 认识的键名。深色主题才 `darkMode: true`。
 *
 * 注意：mermaid 会把颜色写进 SVG 的 `fill` / `style` 属性，`color-mix()` 在那里不生效，
 * 所以混色在这里用 JS 算成具体的 rgb()，不能直接把 CSS 函数塞进 themeVariables。
 */
import { isDarkTheme } from "./theme";

/** mermaid 的 themeVariables 是「键 → 颜色字符串 / 布尔」的扁平表。 */
export type MermaidThemeVars = Record<string, string | boolean>;

/** 从主题里拿到的原始 token（都是 CSS 颜色字符串）。 */
export type ThemeTokens = {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  teal: string;
  gold: string;
  border: string;
};

const FALLBACK: ThemeTokens = {
  bg: "#faf8f3",
  fg: "#2a2620",
  muted: "#7a7468",
  accent: "#3a5080",
  teal: "#3d6b7a",
  gold: "#a87a2c",
  border: "rgba(42, 38, 32, 0.12)",
};

export type Rgba = { r: number; g: number; b: number; a: number };

/** 解析 `#rgb` / `#rrggbb` / `rgb()` / `rgba()`；解析不了返回 null（主题外的怪值一律不用它上色）。 */
export function parseColor(raw: string): Rgba | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map((p) => p.trim());
    if (parts.length < 3) return null;
    const num = (p: string, scale: number) =>
      p.endsWith("%") ? (parseFloat(p) / 100) * scale : parseFloat(p);
    const r = num(parts[0], 255);
    const g = num(parts[1], 255);
    const b = num(parts[2], 255);
    const a = parts[3] === undefined ? 1 : num(parts[3], 1);
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
    return { r, g, b, a };
  }
  return null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** `base` 里掺 `weight`（0–1）比例的 `overlay`，返回 mermaid 能用的 rgb()/rgba()。 */
export function mixColor(base: string, overlay: string, weight: number): string {
  const b = parseColor(base);
  const o = parseColor(overlay);
  if (!b || !o) return base;
  const w = Math.max(0, Math.min(1, weight));
  const mix = (x: number, y: number) => clamp255(x * (1 - w) + y * w);
  const a = b.a * (1 - w) + o.a * w;
  const rgb = `${mix(b.r, o.r)}, ${mix(b.g, o.g)}, ${mix(b.b, o.b)}`;
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Number(a.toFixed(3))})`;
}

/**
 * 从 `getComputedStyle(document.documentElement).getPropertyValue` 这类取值函数拿 token。
 * 空值（主题没定义 / 还没挂上）退回宣纸默认色 —— 图总得能画出来。
 */
export function themeTokensFrom(read: (name: string) => string): ThemeTokens {
  const pick = (name: string, fallback: string) => {
    const raw = (read(name) || "").trim();
    return raw || fallback;
  };
  return {
    bg: pick("--bg", FALLBACK.bg),
    fg: pick("--fg", FALLBACK.fg),
    muted: pick("--muted", FALLBACK.muted),
    accent: pick("--accent", FALLBACK.accent),
    teal: pick("--teal", FALLBACK.teal),
    gold: pick("--gold", FALLBACK.gold),
    border: pick("--border", FALLBACK.border),
  };
}

/**
 * 把主题 token 翻成 mermaid 的 themeVariables。
 *
 * 只用主题给的色相（纸 / 墨 / 青 / 金 / 朱砂），不额外发明颜色：
 * 节点是青系淡底、连线与边标注用金色、正文用墨色、底用纸色。
 */
export function mermaidThemeVars(tokens: ThemeTokens, dark: boolean): MermaidThemeVars {
  const soft = (color: string, weight: number) => mixColor(tokens.bg, color, weight);
  return {
    darkMode: dark,
    background: tokens.bg,
    textColor: tokens.fg,
    titleColor: tokens.fg,
    mainBkg: soft(tokens.teal, 0.16),
    primaryColor: soft(tokens.teal, 0.16),
    primaryTextColor: tokens.fg,
    primaryBorderColor: tokens.teal,
    nodeBorder: tokens.teal,
    secondaryColor: soft(tokens.gold, 0.14),
    secondaryTextColor: tokens.fg,
    secondaryBorderColor: tokens.gold,
    tertiaryColor: soft(tokens.accent, 0.12),
    tertiaryTextColor: tokens.fg,
    tertiaryBorderColor: tokens.accent,
    clusterBkg: soft(tokens.muted, 0.08),
    clusterBorder: tokens.border,
    lineColor: tokens.gold,
    edgeLabelBackground: tokens.bg,
    fontFamily:
      '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  };
}

/** 主题 id → 是否深色（mermaid 的 darkMode 开关）。 */
export function themeIsDark(themeId: string): boolean {
  return isDarkTheme(themeId);
}
