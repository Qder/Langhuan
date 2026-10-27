import { describe, expect, it } from "vitest";
import {
  THEME_IDS,
  THEME_LABELS,
  applyThemeToDocument,
  isDarkTheme,
  nextTheme,
  normalizeTheme,
  themeLabel,
} from "./theme";

describe("normalizeTheme", () => {
  it("maps legacy paper → xuan and ink → songyan", () => {
    expect(normalizeTheme("paper")).toBe("xuan");
    expect(normalizeTheme("ink")).toBe("songyan");
  });

  it("keeps five theme ids", () => {
    for (const id of THEME_IDS) {
      expect(normalizeTheme(id)).toBe(id);
    }
  });

  it("falls back to xuan for unknown", () => {
    expect(normalizeTheme(undefined)).toBe("xuan");
    expect(normalizeTheme("")).toBe("xuan");
    expect(normalizeTheme("neon")).toBe("xuan");
  });
});

describe("isDarkTheme", () => {
  it("marks songyan and cyber dark; others light", () => {
    expect(isDarkTheme("songyan")).toBe(true);
    expect(isDarkTheme("cyber")).toBe(true);
    expect(isDarkTheme("ink")).toBe(true); // legacy
    expect(isDarkTheme("bamboo")).toBe(false);
    expect(isDarkTheme("xuan")).toBe(false);
    expect(isDarkTheme("jiang")).toBe(false);
    expect(isDarkTheme("paper")).toBe(false);
  });
});

describe("nextTheme / labels", () => {
  it("cycles through all five", () => {
    let t: string = "bamboo";
    const seen = new Set<string>();
    for (let i = 0; i < THEME_IDS.length; i++) {
      seen.add(t);
      t = nextTheme(t);
    }
    expect(seen.size).toBe(5);
    expect(t).toBe("bamboo");
  });

  it("has Chinese labels for every id", () => {
    expect(themeLabel("xuan")).toBe("宣纸靛青");
    expect(THEME_LABELS.cyber).toBe("赛博藏经");
  });
});

describe("applyThemeToDocument", () => {
  it("sets data-theme and dark class on a stub documentElement", () => {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains: (name: string) => classes.has(name),
      },
      getAttribute: (k: string) => attrs[k] ?? null,
    };
    const prev = (globalThis as { document?: unknown }).document;
    (globalThis as { document: unknown }).document = { documentElement: root };
    try {
      applyThemeToDocument("songyan");
      expect(root.getAttribute("data-theme")).toBe("songyan");
      expect(root.classList.contains("dark")).toBe(true);

      applyThemeToDocument("xuan");
      expect(root.getAttribute("data-theme")).toBe("xuan");
      expect(root.classList.contains("dark")).toBe(false);

      applyThemeToDocument("paper");
      expect(root.getAttribute("data-theme")).toBe("xuan");
    } finally {
      if (prev === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document: unknown }).document = prev;
    }
  });
});
