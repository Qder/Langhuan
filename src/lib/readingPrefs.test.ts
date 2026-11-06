import { describe, expect, it } from "vitest";
import {
  DEFAULT_READING_PREFS,
  LINE_HEIGHT_OPTIONS,
  PARAGRAPH_SPACING_OPTIONS,
  ZOOM_OPTIONS,
  normalizeReadingPrefs,
  proseWidthForZoom,
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

  it("缩放默认 1，落在 0.9–1.3 之间", () => {
    expect(normalizeReadingPrefs(null).zoom).toBe(1);
    expect(DEFAULT_READING_PREFS.zoom).toBe(1);
    const values = ZOOM_OPTIONS.map((o) => o.value);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.3);
    // 必须含 1，否则老用户没有「回到默认」的档位可点。
    expect(values).toContain(1);
  });

  it("缩放只吸附到档位，越界值不会漏出去", () => {
    expect(normalizeReadingPrefs({ zoom: 5 }).zoom).toBe(1.3);
    expect(normalizeReadingPrefs({ zoom: 0.1 }).zoom).toBe(0.9);
    expect(normalizeReadingPrefs({ zoom: 1.23 }).zoom).toBe(1.2);
    expect(normalizeReadingPrefs({ zoom: 1.31 }).zoom).toBe(1.3);
    expect(normalizeReadingPrefs({ zoom: NaN }).zoom).toBe(1);
    expect(normalizeReadingPrefs({ zoom: "big" } as never).zoom).toBe(1);
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
      zoom: DEFAULT_READING_PREFS.zoom,
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
    const zooms = ZOOM_OPTIONS.map((o) => o.value);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    expect(new Set(zooms).size).toBe(zooms.length);
  });

  it("keeps zoom values exactly when they are already on a stop", () => {
    for (const { value } of ZOOM_OPTIONS) {
      expect(normalizeReadingPrefs({ zoom: value }).zoom).toBe(value);
    }
  });
});

describe("proseWidthForZoom", () => {
  it("1 倍时版心就是 lineWidth 本身", () => {
    expect(proseWidthForZoom(1, 740)).toBe(740);
    expect(proseWidthForZoom(1, 560)).toBe(560);
  });

  it("放大时把内联宽度除回去，视觉版心宽度保持不变", () => {
    // zoom 会把 max-width 一起放大，所以 1.3 倍 + 740 版心 → 内联约 569px。
    // 740 / 1.3 = 569.23 → 取整 569，乘回 1.3 是 739.7，误差不到 1px。
    const inner = proseWidthForZoom(1.3, 740);
    expect(inner).toBe(569);
    expect(Math.abs(inner * 1.3 - 740)).toBeLessThan(1);
  });

  it("缩小时同理，且不会因为取整跑出可见偏差", () => {
    for (const { value } of ZOOM_OPTIONS) {
      const inner = proseWidthForZoom(value, 740);
      expect(Math.abs(inner * value - 740)).toBeLessThan(1);
    }
  });

  it("遇到坏 zoom 值退化成 1，而不是算出 0 或 Infinity", () => {
    expect(proseWidthForZoom(0, 740)).toBe(740);
    expect(proseWidthForZoom(-2, 740)).toBe(740);
    expect(proseWidthForZoom(NaN, 740)).toBe(740);
    expect(proseWidthForZoom(Infinity, 740)).toBe(740);
  });
});
