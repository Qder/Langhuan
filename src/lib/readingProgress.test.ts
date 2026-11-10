import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatReadingPercent,
  subscribeReadingProgress,
  visibleReadingPercent,
  visibleReadingPercentForPath,
} from "./readingProgress";
import { forgetScrollMemory, writeScrollMemory } from "./scrollMemory";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("visibleReadingPercent", () => {
  it("hides missing records and near-zero positions", () => {
    expect(visibleReadingPercent(null)).toBeNull();
    expect(visibleReadingPercent({ top: 0, ratio: 0, savedAt: 1 })).toBeNull();
    expect(visibleReadingPercent({ top: 1, ratio: 0.019, savedAt: 1 })).toBeNull();
  });

  it("shows a rounded percent once the reader has actually moved", () => {
    expect(visibleReadingPercent({ top: 80, ratio: 0.356, savedAt: 1 })).toBe(36);
    expect(visibleReadingPercent({ top: 200, ratio: 1, savedAt: 1 })).toBe(100);
    expect(formatReadingPercent(36)).toBe("36%");
  });

  it("reads live memory by path and notifies subscribers", () => {
    expect(visibleReadingPercentForPath("notes/a.md")).toBeNull();
    const onChange = vi.fn();
    const stop = subscribeReadingProgress(onChange);
    writeScrollMemory("notes/a.md", 40, 100);
    expect(visibleReadingPercentForPath("notes/a.md")).toBe(40);
    expect(onChange).toHaveBeenCalled();
    forgetScrollMemory("notes/a.md");
    expect(visibleReadingPercentForPath("notes/a.md")).toBeNull();
    stop();
  });
});
