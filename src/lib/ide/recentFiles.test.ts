import { describe, expect, it } from "vitest";
import {
  IDE_RECENT_FILES_MAX,
  normalizeRecentFiles,
  pruneRecentFilesForSession,
  pushRecentFile,
  recentFilesForSession,
  type IdeRecentFile,
} from "./recentFiles";

function rec(over: Partial<IdeRecentFile> = {}): IdeRecentFile {
  return {
    sessionId: "fsa:demo",
    projectName: "demo",
    path: "src/A.java",
    openedAt: 1,
    ...over,
  };
}

describe("pushRecentFile", () => {
  it("moves a re-opened path to the front", () => {
    const list = [rec({ path: "a.ts", openedAt: 5 }), rec({ path: "b.ts", openedAt: 3 })];
    const next = pushRecentFile(list, rec({ path: "b.ts", openedAt: 9 }));
    expect(next.map((r) => r.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("keeps the same relative path from two different projects", () => {
    const list = [rec({ sessionId: "fsa:one", path: "a.ts" })];
    const next = pushRecentFile(list, rec({ sessionId: "fsa:two", path: "a.ts" }));
    expect(next).toHaveLength(2);
    expect(next[0].sessionId).toBe("fsa:two");
  });

  it("drops empty paths and caps at the max", () => {
    expect(pushRecentFile([], rec({ path: "  " }))).toEqual([]);
    let list: IdeRecentFile[] = [];
    for (let i = 0; i < IDE_RECENT_FILES_MAX + 5; i++) {
      list = pushRecentFile(list, rec({ path: `f${i}.ts`, openedAt: i }));
    }
    expect(list).toHaveLength(IDE_RECENT_FILES_MAX);
    expect(list[0].path).toBe(`f${IDE_RECENT_FILES_MAX + 4}.ts`);
  });
});

describe("pruneRecentFilesForSession", () => {
  it("removes every row belonging to the deleted project only", () => {
    const list = [
      rec({ sessionId: "fsa:a", path: "one.ts" }),
      rec({ sessionId: "fsa:b", path: "two.ts" }),
      rec({ sessionId: "fsa:a", path: "three.ts" }),
    ];
    const next = pruneRecentFilesForSession(list, "fsa:a");
    expect(next.map((r) => `${r.sessionId}:${r.path}`)).toEqual(["fsa:b:two.ts"]);
  });

  it("is a no-op for an unknown session", () => {
    const list = [rec({ sessionId: "fsa:a" })];
    expect(pruneRecentFilesForSession(list, "fsa:zzz")).toEqual(list);
  });

  it("does not leave ghost rows on the welcome screen after a project delete", () => {
    const list = [
      rec({ sessionId: "fsa:gone", path: "a.ts" }),
      rec({ sessionId: "fsa:gone", path: "b.ts" }),
      rec({ sessionId: "fsa:kept", path: "c.ts" }),
    ];
    const remaining = pruneRecentFilesForSession(list, "fsa:gone");
    expect(remaining.every((r) => r.sessionId === "fsa:kept")).toBe(true);
    expect(remaining).toHaveLength(1);
  });
});

describe("recentFilesForSession", () => {
  it("filters by session, newest first, and caps", () => {
    const list = [
      rec({ sessionId: "fsa:a", path: "old.ts", openedAt: 1 }),
      rec({ sessionId: "fsa:b", path: "other.ts", openedAt: 5 }),
      rec({ sessionId: "fsa:a", path: "new.ts", openedAt: 9 }),
    ];
    expect(recentFilesForSession(list, "fsa:a")).toEqual(["new.ts", "old.ts"]);
    expect(recentFilesForSession(list, "fsa:a", 1)).toEqual(["new.ts"]);
  });

  it("returns nothing without a session", () => {
    expect(recentFilesForSession([rec()], null)).toEqual([]);
    expect(recentFilesForSession([rec()], undefined)).toEqual([]);
    expect(recentFilesForSession([rec()], "")).toEqual([]);
  });
});

describe("normalizeRecentFiles", () => {
  it("drops junk, dedupes by session+path, and sorts newest first", () => {
    const out = normalizeRecentFiles([
      null,
      "nope",
      { sessionId: "fsa:a", path: "a.ts", openedAt: 2 },
      { sessionId: "fsa:a", path: "a.ts", openedAt: 7 },
      { sessionId: "fsa:a", path: "", openedAt: 9 },
      { sessionId: "fsa:b", path: "b.ts", openedAt: 5 },
    ]);
    expect(out.map((r) => `${r.sessionId}:${r.path}`)).toEqual([
      "fsa:a:a.ts",
      "fsa:b:b.ts",
    ]);
    expect(out[0].openedAt).toBe(7);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeRecentFiles(undefined)).toEqual([]);
    expect(normalizeRecentFiles({})).toEqual([]);
  });
});
