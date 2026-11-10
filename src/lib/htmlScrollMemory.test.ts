import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeScrollMemoryPercent } from "./scrollMemory";
import {
  restorePercentForPath,
  shouldYieldHtmlScrollRestore,
} from "./htmlScrollMemory";

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

describe("shouldYieldHtmlScrollRestore", () => {
  it("yields to any in-flight preview locate", () => {
    expect(
      shouldYieldHtmlScrollRestore({
        pendingPreviewLocate: { offset: 12, nonce: 1 },
        pendingQuizReveal: null,
        docId: "html-1",
      })
    ).toBe(true);
  });

  it("yields to a quiz jump aimed at this document only", () => {
    expect(
      shouldYieldHtmlScrollRestore({
        pendingPreviewLocate: null,
        pendingQuizReveal: { docId: "html-1" },
        docId: "html-1",
      })
    ).toBe(true);
    expect(
      shouldYieldHtmlScrollRestore({
        pendingPreviewLocate: null,
        pendingQuizReveal: { docId: "other" },
        docId: "html-1",
      })
    ).toBe(false);
  });

  it("does not yield when nothing is pending", () => {
    expect(
      shouldYieldHtmlScrollRestore({
        pendingPreviewLocate: null,
        pendingQuizReveal: null,
        docId: "html-1",
      })
    ).toBe(false);
  });
});

describe("restorePercentForPath", () => {
  it("returns the stored percent and skips missing or top positions", () => {
    expect(restorePercentForPath("")).toBeNull();
    expect(restorePercentForPath("gone.html")).toBeNull();
    writeScrollMemoryPercent("page.html", 0);
    expect(restorePercentForPath("page.html")).toBeNull();
    writeScrollMemoryPercent("page.html", 42);
    expect(restorePercentForPath("page.html")).toBeCloseTo(42, 5);
  });
});
