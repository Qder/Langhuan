import { describe, expect, it } from "vitest";
import {
  buildIndexFromDocuments,
  emptyIndex,
  planSyncIn,
  safeRelPath,
  type DiskDoc,
} from "./fsSync";
import type { Document } from "../types";

function doc(partial: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: partial.path.endsWith(".html") ? "html" : "md",
    starred: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...partial,
  };
}

describe("safeRelPath", () => {
  it("strips traversal and leading slashes", () => {
    expect(safeRelPath("../a/b.md")).toBe("a/b.md");
    expect(safeRelPath("/notes/x.md")).toBe("notes/x.md");
    expect(safeRelPath("a\\b\\c.md")).toBe("a/b/c.md");
  });
});

describe("planSyncIn", () => {
  it("imports new disk files", () => {
    const library: Document[] = [doc({ id: "1", path: "a.md", content: "A" })];
    const disk: DiskDoc[] = [
      { path: "a.md", content: "A", mtime: 2000 },
      { path: "b.md", content: "B", mtime: 3000 },
    ];
    const { next, result } = planSyncIn(library, disk, emptyIndex());
    expect(result.imported).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(next.map((d) => d.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("lets disk win when both changed since last sync", () => {
    const library: Document[] = [
      doc({ id: "1", path: "a.md", content: "lib", updatedAt: 5000 }),
    ];
    const disk: DiskDoc[] = [{ path: "a.md", content: "disk", mtime: 6000 }];
    const index = buildIndexFromDocuments(library, 1000);
    const { next, result } = planSyncIn(library, disk, index);
    expect(result.conflicts).toEqual(["a.md"]);
    expect(next[0].content).toBe("disk");
  });

  it("keeps library when it is newer than disk", () => {
    const library: Document[] = [
      doc({ id: "1", path: "a.md", content: "lib", updatedAt: 9000 }),
    ];
    const disk: DiskDoc[] = [{ path: "a.md", content: "disk", mtime: 3000 }];
    const index = buildIndexFromDocuments(library, 2000);
    // mark lastSynced after disk mtime but before library update
    index.documents["a.md"].lastSyncedAt = 4000;
    const { next, result } = planSyncIn(library, disk, index);
    expect(result.updated).toBe(0);
    expect(next[0].content).toBe("lib");
  });
});
