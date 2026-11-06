import { describe, expect, it } from "vitest";
import {
  DEFAULT_READING_PREFS,
  LINE_HEIGHT_OPTIONS,
  PARAGRAPH_SPACING_OPTIONS,
  normalizeReadingPrefs,
} from "./readingPrefs";

describe("normalizeReadingPrefs", () => {
  it("clamps and defaults", () => {
    expect(normalizeReadingPrefs(null)).toEqual(DEFAULT_READING_PREFS);
    expect(normalizeReadingPrefs({ fontSize: 99, lineWidth: 100 }).fontSize).toBe(22);
    expect(normalizeReadingPrefs({ fontSize: 10, lineWidth: 100 }).lineWidth).toBe(560);
    expect(normalizeReadingPrefs({ focusMode: true }).focusMode).toBe(true);
  });

  it("defaults line height / paragraph spacing to the current look", () => {
    const prefs = normalizeReadingPrefs(null);
    // 必须和 globals.css 里原来的字面量一致，否则这个功能一上线就改了观感。
    expect(prefs.lineHeight).toBe(1.95);
    expect(prefs.paragraphSpacing).toBe(0.85);
    expect(DEFAULT_READING_PREFS.lineHeight).toBe(1.95);
    expect(DEFAULT_READING_PREFS.paragraphSpacing).toBe(0.85);
  });

  it("snaps arbitrary values to the nearest shipped option", () => {
    expect(normalizeReadingPrefs({ lineHeight: 2.01 }).lineHeight).toBe(1.95);
    expect(normalizeReadingPrefs({ lineHeight: 2.4 }).lineHeight).toBe(2.5);
    expect(normalizeReadingPrefs({ paragraphSpacing: 1.05 }).paragraphSpacing).toBe(1.2);
    expect(normalizeReadingPrefs({ paragraphSpacing: 0.6 }).paragraphSpacing).toBe(0.5);
    expect(normalizeReadingPrefs({ paragraphSpacing: 1.55 }).paragraphSpacing).toBe(1.6);
  });

  it("keeps valid values exactly", () => {
    for (const { value } of LINE_HEIGHT_OPTIONS) {
      expect(normalizeReadingPrefs({ lineHeight: value }).lineHeight).toBe(value);
    }
    for (const { value } of PARAGRAPH_SPACING_OPTIONS) {
      expect(normalizeReadingPrefs({ paragraphSpacing: value }).paragraphSpacing).toBe(
        value
      );
    }
  });

  it("survives junk from old persisted state / backups", () => {
    const junk = { lineHeight: NaN, paragraphSpacing: "wide" } as unknown;
    const prefs = normalizeReadingPrefs(junk as never);
    expect(prefs.lineHeight).toBe(DEFAULT_READING_PREFS.lineHeight);
    expect(prefs.paragraphSpacing).toBe(DEFAULT_READING_PREFS.paragraphSpacing);
    expect(normalizeReadingPrefs({ lineHeight: Infinity }).lineHeight).toBe(
      DEFAULT_READING_PREFS.lineHeight
    );
  });

  it("old persisted prefs without the new keys gain the defaults", () => {
    // 模拟 6031f64 时代的存档：只有字号/行宽/focus。
    const old = { fontSize: 19, lineWidth: 680, focusMode: true };
    const prefs = normalizeReadingPrefs(old);
    expect(prefs).toEqual({
      fontSize: 19,
      lineWidth: 680,
      lineHeight: DEFAULT_READING_PREFS.lineHeight,
      paragraphSpacing: DEFAULT_READING_PREFS.paragraphSpacing,
      focusMode: true,
      typewriterMode: false,
    });
  });

  it("typewriterMode 默认关，且能从存档里读回 true", () => {
    expect(DEFAULT_READING_PREFS.typewriterMode).toBe(false);
    expect(normalizeReadingPrefs(null).typewriterMode).toBe(false);
    expect(normalizeReadingPrefs({ typewriterMode: true }).typewriterMode).toBe(true);
    // 与 focusMode 一致用 `!!`：缺省/假值都落成布尔，不会留 undefined。
    expect(normalizeReadingPrefs({ typewriterMode: undefined }).typewriterMode).toBe(
      false
    );
    expect(normalizeReadingPrefs({ typewriterMode: 0 } as never).typewriterMode).toBe(
      false
    );
  });

  it("option lists are sorted and deduped", () => {
    const heights = LINE_HEIGHT_OPTIONS.map((o) => o.value);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(heights.length);
    const gaps = PARAGRAPH_SPACING_OPTIONS.map((o) => o.value);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(new Set(gaps).size).toBe(gaps.length);
  });
});
