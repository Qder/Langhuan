import { describe, expect, it } from "vitest";
import {
  OUTLINE_DEBOUNCE_LARGE_MS,
  OUTLINE_DEBOUNCE_MS,
  OUTLINE_LARGE_LINES,
  outlineDebounceMs,
  planOutlineRefresh,
} from "./outlineRefresh";

describe("outlineDebounceMs", () => {
  it("uses the small-file delay for ordinary files", () => {
    expect(outlineDebounceMs("export const a = 1;\n")).toBe(OUTLINE_DEBOUNCE_MS);
  });

  it("waits longer for a file with many lines", () => {
    const many = "const a = 1;\n".repeat(OUTLINE_LARGE_LINES + 5);
    expect(outlineDebounceMs(many)).toBe(OUTLINE_DEBOUNCE_LARGE_MS);
  });

  it("waits longer for a file with many characters", () => {
    const wide = "x".repeat(210_000);
    expect(outlineDebounceMs(wide)).toBe(OUTLINE_DEBOUNCE_LARGE_MS);
  });

  it("stays inside the 100–200ms window the rail promises", () => {
    expect(OUTLINE_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
    expect(OUTLINE_DEBOUNCE_LARGE_MS).toBeGreaterThanOrEqual(OUTLINE_DEBOUNCE_MS);
    expect(OUTLINE_DEBOUNCE_LARGE_MS).toBeLessThanOrEqual(200);
  });
});

describe("planOutlineRefresh", () => {
  it("recomputes immediately when the file changes", () => {
    expect(planOutlineRefresh("src/a.ts", "src/b.ts", "anything")).toEqual({
      immediate: true,
      delay: 0,
    });
  });

  it("debounces a same-file edit rather than sweeping every keystroke", () => {
    const plan = planOutlineRefresh("src/a.ts", "src/a.ts", "const a = 1;\n");
    expect(plan.immediate).toBe(false);
    expect(plan).toEqual({ immediate: false, delay: OUTLINE_DEBOUNCE_MS });
  });

  it("scales the delay with the size of the edited file", () => {
    const big = "const a = 1;\n".repeat(OUTLINE_LARGE_LINES + 1);
    expect(planOutlineRefresh("src/a.ts", "src/a.ts", big).delay).toBe(
      OUTLINE_DEBOUNCE_LARGE_MS
    );
  });
});
