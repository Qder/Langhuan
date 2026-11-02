import { describe, expect, it } from "vitest";
import {
  applyExternalPull,
  buildIndexFromDocuments,
  detectExternalChanges,
  emptyIndex,
  planSyncIn,
  safeRelPath,
  type DiskDoc,
  type ExternalChange,
} from "./fsSync";
import type { AssetMeta, Document } from "../types";

function doc(partial: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: partial.path.endsWith(".html") ? "html" : "md",
    starred: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...partial,
  };
}

function disk(path: string, content: string, mtime: number): DiskDoc {
  const enc = new TextEncoder().encode(content);
  return { path, content, mtime, size: enc.length };
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
    const diskFiles: DiskDoc[] = [
      disk("a.md", "A", 2000),
      disk("b.md", "B", 3000),
    ];
    const { next, result } = planSyncIn(library, diskFiles, emptyIndex());
    expect(result.imported).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(next.map((d) => d.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("keeps content/ when both changed since last sync", () => {
    const library: Document[] = [
      doc({ id: "1", path: "a.md", content: "lib", updatedAt: 5000 }),
    ];
    const diskFiles: DiskDoc[] = [disk("a.md", "disk", 6000)];
    const index = buildIndexFromDocuments(library, 1000);
    const { next, result } = planSyncIn(library, diskFiles, index);
    expect(result.conflicts).toEqual(["a.md"]);
    expect(next[0].content).toBe("lib");
  });

  it("keeps library when it is newer than disk", () => {
    const library: Document[] = [
      doc({ id: "1", path: "a.md", content: "lib", updatedAt: 9000 }),
    ];
    const diskFiles: DiskDoc[] = [disk("a.md", "disk", 3000)];
    const index = buildIndexFromDocuments(library, 2000);
    index.documents["a.md"].lastSyncedAt = 4000;
    const { next, result } = planSyncIn(library, diskFiles, index);
    expect(result.updated).toBe(0);
    expect(next[0].content).toBe("lib");
  });
});

describe("detectExternalChanges", () => {
  it("lists add modify delete and conflict; pull keeps content on conflict", () => {
    const library: Document[] = [
      doc({ id: "1", path: "keep.md", content: "same", updatedAt: 2000 }),
      doc({ id: "2", path: "gone.md", content: "x", updatedAt: 2000 }),
      doc({ id: "3", path: "both.md", content: "lib", updatedAt: 8000 }),
      doc({ id: "4", path: "disk-newer.md", content: "old", updatedAt: 2000 }),
    ];
    const index = buildIndexFromDocuments(library, 3000);
    const diskDocs: DiskDoc[] = [
      disk("keep.md", "same", 2000),
      disk("new.md", "hello", 9000),
      disk("both.md", "disk", 9000),
      disk("disk-newer.md", "fresh", 9000),
    ];
    const changes = detectExternalChanges(library, [], diskDocs, [], index);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c.change]));
    expect(byPath["new.md"]).toBe("add");
    expect(byPath["gone.md"]).toBe("delete");
    expect(byPath["both.md"]).toBe("conflict");
    expect(byPath["disk-newer.md"]).toBe("modify");
    expect(byPath["keep.md"]).toBeUndefined();

    const selected = changes.filter((c) => c.change !== "conflict") as ExternalChange[];
    const pulled = applyExternalPull(library, [], diskDocs, [], index, selected);
    expect(pulled.skippedConflicts).toEqual([]);
    expect(pulled.documents.find((d) => d.path === "new.md")?.content).toBe("hello");
    expect(pulled.documents.find((d) => d.path === "gone.md")).toBeUndefined();
    expect(pulled.documents.find((d) => d.path === "disk-newer.md")?.content).toBe("fresh");
    // conflict not in selected — library value remains if we also pass conflict as skipped
    const withConflict = applyExternalPull(
      library,
      [],
      diskDocs,
      [],
      index,
      changes
    );
    expect(withConflict.skippedConflicts).toEqual(["both.md"]);
    expect(withConflict.documents.find((d) => d.path === "both.md")?.content).toBe("lib");
  });

  it("flags new external images as asset adds", () => {
    const assets: AssetMeta[] = [];
    const changes = detectExternalChanges(
      [],
      assets,
      [],
      [{ path: "notes/assets/shot.png", mtime: 1, size: 12 }],
      emptyIndex()
    );
    expect(changes).toEqual([
      expect.objectContaining({
        path: "notes/assets/shot.png",
        entity: "asset",
        change: "add",
      }),
    ]);
  });
});
