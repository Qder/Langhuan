import type { ThemeMode } from "./types";

/** Stable theme ids (UI shows Chinese labels). */
export const THEME_IDS = [
  "bamboo",
  "xuan",
  "songyan",
  "jiang",
  "cyber",
  "phycat",
  "phycat-mint",
  "phycat-sky",
  "phycat-abyss",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_LABELS: Record<ThemeId, string> = {
  bamboo: "青灯竹影",
  xuan: "宣纸靛青",
  songyan: "松烟月白",
  jiang: "绛帐缃帙",
  cyber: "赛博藏经",
  phycat: "绯猫樱华",
  "phycat-mint": "绯猫薄荷",
  "phycat-sky": "绯猫晴空",
  "phycat-abyss": "绯猫深渊",
};

/** Short blurbs for picker / status. */
export const THEME_HINTS: Record<ThemeId, string> = {
  bamboo: "浅青灰 · 墨绿 · 竹青",
  xuan: "宣纸白 · 靛青",
  songyan: "深炭 · 月白 · 银灰",
  jiang: "暖米黄 · 绛紫 · 缃黄",
  cyber: "深底 · 青绿终端色",
  phycat: "樱粉 · Phycat sakura",
  "phycat-mint": "薄荷绿 · Phycat mint",
  "phycat-sky": "晴空蓝 · Phycat sky",
  "phycat-abyss": "雾青 · Phycat abyss",
};

/** Palette swatch for the sidebar theme menu. */
export const THEME_SWATCHES: Record<ThemeId, string> = {
  bamboo: "#2f6b4f",
  xuan: "#3a5080",
  songyan: "#a8b0bc",
  jiang: "#8b3a4a",
  cyber: "#2dd4bf",
  phycat: "#c43d62",
  "phycat-mint": "#1f8e94",
  "phycat-sky": "#2176b3",
  "phycat-abyss": "#7eb4c4",
};

const DARK_THEMES: ReadonlySet<ThemeId> = new Set([
  "songyan",
  "cyber",
  "phycat-abyss",
]);

/** Legacy binary ids → new theme ids. */
const LEGACY_MAP: Record<string, ThemeId> = {
  paper: "xuan",
  ink: "songyan",
};

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

/** Normalize persisted / FOUC values; unknown → 宣纸靛青. */
export function normalizeTheme(raw: unknown): ThemeId {
  if (typeof raw !== "string" || !raw) return "xuan";
  if (isThemeId(raw)) return raw;
  const mapped = LEGACY_MAP[raw];
  if (mapped) return mapped;
  return "xuan";
}

export function isDarkTheme(theme: ThemeMode | string): boolean {
  return DARK_THEMES.has(normalizeTheme(theme));
}

export function themeLabel(theme: ThemeMode | string): string {
  return THEME_LABELS[normalizeTheme(theme)];
}

/** Cycle order for toggleTheme. */
export function nextTheme(current: ThemeMode | string): ThemeId {
  const cur = normalizeTheme(current);
  const i = THEME_IDS.indexOf(cur);
  return THEME_IDS[(i + 1) % THEME_IDS.length];
}

/**
 * Apply theme to <html>: data-theme + .dark for dark themes
 * (Tailwind / CodeMirror / legacy html.dark rules).
 */
export function applyThemeToDocument(theme: ThemeMode | string): void {
  if (typeof document === "undefined") return;
  const id = normalizeTheme(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.classList.toggle("dark", isDarkTheme(id));
}

export const THEME_STORAGE_KEY = "langhuan-theme";
