import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MD_SCROLL_MAX_DOCS,
  MD_SCROLL_STORAGE_KEY,
  forgetScrollMemory,
  forgetScrollMemoryMany,
  readScrollMemory,
  readScrollMemoryPercent,
  renameScrollMemory,
  renameScrollMemoryMany,
  scrollTargetFor,
  writeScrollMemory,
  writeScrollMemoryPercent,
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

  it("forget is a no-op for absent paths and never writes", () => {
    writeScrollMemory("a.md", 100, 1000);
    const before = store.get(MD_SCROLL_STORAGE_KEY);
    forgetScrollMemory("nope.md");
    expect(store.get(MD_SCROLL_STORAGE_KEY)).toBe(before);
  });

  it("forgetMany clears a folder in one pass", () => {
    writeScrollMemory("pack/a.md", 10, 1000);
    writeScrollMemory("pack/sub/b.md", 20, 1000);
    writeScrollMemory("keep.md", 30, 1000);

    expect(forgetScrollMemoryMany(["pack/a.md", "pack/sub/b.md"])).toBe(2);
    expect(readScrollMemory("pack/a.md")).toBeNull();
    expect(readScrollMemory("pack/sub/b.md")).toBeNull();
    expect(readScrollMemory("keep.md")!.top).toBe(30);
    expect(forgetScrollMemoryMany(["gone.md"])).toBe(0);
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

describe("scroll memory percent (HTML)", () => {
  it("stores a 0–100 percent as ratio and reads it back", () => {
    writeScrollMemoryPercent("page.html", 25);
    expect(readScrollMemoryPercent("page.html")).toBeCloseTo(25, 5);
    expect(readScrollMemory("page.html")!.ratio).toBeCloseTo(0.25, 5);
    expect(readScrollMemory("page.html")!.top).toBe(25);
  });

  it("keeps HTML and Markdown paths isolated in the same map", () => {
    writeScrollMemory("notes.md", 400, 2000);
    writeScrollMemoryPercent("notes.html", 80);
    expect(readScrollMemory("notes.md")!.top).toBe(400);
    expect(readScrollMemoryPercent("notes.html")).toBeCloseTo(80, 5);
  });

  it("allows 0 (scrolled to top) and ignores non-finite input", () => {
    writeScrollMemoryPercent("a.html", 40);
    writeScrollMemoryPercent("a.html", Number.NaN);
    expect(readScrollMemoryPercent("a.html")).toBeCloseTo(40, 5);
    writeScrollMemoryPercent("a.html", 0);
    expect(readScrollMemoryPercent("a.html")).toBe(0);
  });

  it("returns null when there is no record", () => {
    expect(readScrollMemoryPercent("missing.html")).toBeNull();
    expect(readScrollMemoryPercent("")).toBeNull();
  });

  it("rename and forget still work for HTML paths", () => {
    writeScrollMemoryPercent("old.html", 60);
    renameScrollMemory("old.html", "new.html");
    expect(readScrollMemoryPercent("old.html")).toBeNull();
    expect(readScrollMemoryPercent("new.html")).toBeCloseTo(60, 5);
    forgetScrollMemory("new.html");
    expect(readScrollMemoryPercent("new.html")).toBeNull();
  });
});

describe("scroll memory rename", () => {
  it("carries the position to the new path and drops the old one", () => {
    writeScrollMemory("旧名.md", 400, 2000);
    const before = readScrollMemory("旧名.md")!;

    renameScrollMemory("旧名.md", "新名.md");

    expect(readScrollMemory("旧名.md")).toBeNull();
    expect(readScrollMemory("新名.md")).toEqual(before);
  });

  it("does nothing when the old path was never read", () => {
    writeScrollMemory("other.md", 100, 1000);
    const before = store.get(MD_SCROLL_STORAGE_KEY);

    renameScrollMemory("never-read.md", "somewhere.md");

    expect(store.get(MD_SCROLL_STORAGE_KEY)).toBe(before);
    expect(readScrollMemory("somewhere.md")).toBeNull();
  });

  it("keeps the current occupant when the name is already taken", () => {
    writeScrollMemory("a.md", 100, 1000);
    writeScrollMemory("b.md", 900, 1000);

    renameScrollMemory("a.md", "b.md");

    // b.md 现在属于另一个文件，不能被路过用户的旧位置顶掉。
    expect(readScrollMemory("b.md")!.top).toBe(900);
    expect(readScrollMemory("a.md")).toBeNull();
  });

  it("is a no-op for same path / empty inputs", () => {
    writeScrollMemory("a.md", 100, 1000);
    const before = store.get(MD_SCROLL_STORAGE_KEY);
    renameScrollMemory("a.md", "a.md");
    renameScrollMemory("", "b.md");
    renameScrollMemory("a.md", "");
    expect(store.get(MD_SCROLL_STORAGE_KEY)).toBe(before);
  });

  it("moves a whole renamed folder in one pass", () => {
    writeScrollMemory("pack/a.md", 100, 1000);
    writeScrollMemory("pack/sub/b.md", 200, 1000);
    writeScrollMemory("outside.md", 300, 1000);

    renameScrollMemoryMany([
      ["pack/a.md", "box/a.md"],
      ["pack/sub/b.md", "box/sub/b.md"],
    ]);

    expect(readScrollMemory("pack/a.md")).toBeNull();
    expect(readScrollMemory("pack/sub/b.md")).toBeNull();
    expect(readScrollMemory("box/a.md")!.top).toBe(100);
    expect(readScrollMemory("box/sub/b.md")!.top).toBe(200);
    expect(readScrollMemory("outside.md")!.top).toBe(300);
  });

  it("renameMany skips pairs it has no record for", () => {
    writeScrollMemory("pack/a.md", 100, 1000);
    renameScrollMemoryMany([
      ["pack/a.md", "box/a.md"],
      ["pack/missing.md", "box/missing.md"],
    ] as const);
    expect(readScrollMemory("box/a.md")!.top).toBe(100);
    expect(readScrollMemory("box/missing.md")).toBeNull();
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
