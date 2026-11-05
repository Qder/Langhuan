import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MD_SCROLL_MAX_DOCS,
  MD_SCROLL_STORAGE_KEY,
  forgetScrollMemory,
  readScrollMemory,
  scrollTargetFor,
  writeScrollMemory,
} from "./scrollMemory";

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

describe("scroll memory", () => {
  it("round-trips a position per path, keeping docs isolated", () => {
    writeScrollMemory("algo/sort.md", 400, 2000);
    writeScrollMemory("algo/graph.md", 100, 800);

    expect(readScrollMemory("algo/sort.md")).toMatchObject({ top: 400 });
    expect(readScrollMemory("algo/graph.md")).toMatchObject({ top: 100 });
    expect(readScrollMemory("algo/missing.md")).toBeNull();
    expect(readScrollMemory("")).toBeNull();
  });

  it("stores a 0–1 ratio and a timestamp", () => {
    writeScrollMemory("a.md", 300, 1200);
    const entry = readScrollMemory("a.md")!;
    expect(entry.ratio).toBeCloseTo(0.25, 5);
    expect(entry.savedAt).toBeGreaterThan(0);
  });

  it("clamps ratio into 0–1", () => {
    writeScrollMemory("a.md", 999999, 1000);
    expect(readScrollMemory("a.md")!.ratio).toBe(1);
    writeScrollMemory("b.md", -50, 1000);
    expect(readScrollMemory("b.md")!.ratio).toBe(0);
    expect(readScrollMemory("b.md")!.top).toBe(0);
  });

  it("ignores unwritable measurements (hidden panel, short content)", () => {
    writeScrollMemory("a.md", 500, 1000);
    writeScrollMemory("a.md", 0, 0); // max <= 0 → 不覆盖
    expect(readScrollMemory("a.md")!.top).toBe(500);
    writeScrollMemory("a.md", NaN, 1000);
    expect(readScrollMemory("a.md")!.top).toBe(500);
  });

  it("forget drops just the one doc", () => {
    writeScrollMemory("a.md", 100, 1000);
    writeScrollMemory("b.md", 200, 1000);
    forgetScrollMemory("a.md");
    expect(readScrollMemory("a.md")).toBeNull();
    expect(readScrollMemory("b.md")!.top).toBe(200);
  });

  it("silently drops corrupt or partial records", () => {
    store.set(
      MD_SCROLL_STORAGE_KEY,
      JSON.stringify({
        "good.md": { top: 10, ratio: 0.1, savedAt: 1 },
        "partial.md": { top: 10 },
        "wrong.md": "nope",
      })
    );
    expect(readScrollMemory("good.md")!.top).toBe(10);
    expect(readScrollMemory("partial.md")).toBeNull();
    expect(readScrollMemory("wrong.md")).toBeNull();
  });

  it("survives a damaged JSON blob without throwing", () => {
    store.set(MD_SCROLL_STORAGE_KEY, "{not json");
    expect(readScrollMemory("a.md")).toBeNull();
    writeScrollMemory("a.md", 10, 100);
    expect(readScrollMemory("a.md")!.top).toBe(10);
  });

  it("evicts the oldest docs past the cap", () => {
    for (let i = 0; i < MD_SCROLL_MAX_DOCS + 5; i++) {
      writeScrollMemory(`doc-${i}.md`, i + 1, 10000);
    }
    const raw = JSON.parse(store.get(MD_SCROLL_STORAGE_KEY)!) as Record<
      string,
      { top: number }
    >;
    expect(Object.keys(raw)).toHaveLength(MD_SCROLL_MAX_DOCS);
    expect(raw["doc-0.md"]).toBeUndefined();
    expect(raw[`doc-${MD_SCROLL_MAX_DOCS + 4}.md`]).toBeDefined();
  });
});

describe("scrollTargetFor", () => {
  const entry = (ratio: number, top = 0) => ({ ratio, top, savedAt: 1 });

  it("maps the ratio onto the current scrollable range", () => {
    // 正文变高了：旧 25% 现在落在新的 max 上，而不是旧像素值。
    expect(scrollTargetFor(entry(0.25, 300), 5000, 1000)).toBe(1000);
  });

  it("falls back to the recorded top only when the ratio is unusable", () => {
    expect(scrollTargetFor(entry(0.5, 42), 1000, 0)).toBe(500);
  });

  it("returns null when there is nothing to scroll", () => {
    expect(scrollTargetFor(entry(0.5), 800, 800)).toBeNull();
    expect(scrollTargetFor(entry(0.5), 0, 0)).toBeNull();
  });

  it("clamps when the position now overflows", () => {
    expect(scrollTargetFor(entry(1), 1000, 400)).toBe(600);
  });
});
