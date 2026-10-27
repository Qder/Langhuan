import { describe, expect, it } from "vitest";
import { DEFAULT_READING_PREFS, normalizeReadingPrefs } from "./readingPrefs";

describe("normalizeReadingPrefs", () => {
  it("clamps and defaults", () => {
    expect(normalizeReadingPrefs(null)).toEqual(DEFAULT_READING_PREFS);
    expect(normalizeReadingPrefs({ fontSize: 99, lineWidth: 100 }).fontSize).toBe(22);
    expect(normalizeReadingPrefs({ fontSize: 10, lineWidth: 100 }).lineWidth).toBe(560);
    expect(normalizeReadingPrefs({ focusMode: true }).focusMode).toBe(true);
  });
});
