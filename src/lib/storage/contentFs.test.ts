import { describe, expect, it } from "vitest";
import { safeRelPath } from "./pathSanitize";
import { emptyIndex, mergeIndexEntry } from "./contentFs";

describe("safeRelPath (content)", () => {
  it("strips traversal and leading slashes", () => {
    expect(safeRelPath("../a/b.md")).toBe("a/b.md");
    expect(safeRelPath("/notes/x.md")).toBe("notes/x.md");
    expect(safeRelPath("a\\b\\c.md")).toBe("a/b/c.md");
    expect(safeRelPath("a/./b/../c.md")).toBe("a/c.md");
  });
});

describe("mergeIndexEntry", () => {
  it("upserts by sanitized path", () => {
    const idx = emptyIndex();
    const next = mergeIndexEntry(idx, {
      id: "1",
      path: "/notes/hi.md",
      starred: true,
      createdAt: 10,
      updatedAt: 20,
    }, 99);
    expect(next.documents["notes/hi.md"]).toEqual({
      id: "1",
      starred: true,
      createdAt: 10,
      updatedAt: 20,
      lastSyncedAt: 99,
    });
    expect(next.updatedAt).toBe(99);
  });
});
