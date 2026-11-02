import { describe, expect, it } from "vitest";
import {
  applyDiskOverwrite,
  applyExternalPull,
  buildIndexAfterExternalPull,
  buildIndexFromDocuments,
  detectExternalChanges,
  emptyIndex,
  excerptForCompare,
  markAssetsSynced,
  normalizeFsIndex,
  patchIndexAfterDiskOverwrite,
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


describe("conflict excerpts and asset deletes", () => {
  it("truncates excerpts to about 12 lines", () => {
    const body = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n");
    const ex = excerptForCompare(body, 12);
    expect(ex.split("\n").length).toBe(13); // 12 lines + ellipsis line
    expect(ex.endsWith("…")).toBe(true);
  });

  it("attaches conflict excerpts and reports vanished mirrored png; unchecked delete stays", () => {
    const library = [
      doc({ id: "1", path: "both.md", content: "lib-line-1\nlib-line-2", updatedAt: 8000 }),
    ];
    const assets: AssetMeta[] = [
      {
        id: "a1",
        path: "notes/assets/gone.png",
        mime: "image/png",
        size: 10,
        createdAt: 1000,
      },
      {
        id: "a2",
        path: "notes/assets/keep.png",
        mime: "image/png",
        size: 10,
        createdAt: 1000,
      },
    ];
    // Only previously mirrored attachments may appear as asset deletes.
    const index = markAssetsSynced(
      buildIndexFromDocuments(library, 3000),
      ["notes/assets/gone.png", "notes/assets/keep.png"],
      3000,
    );
    const diskDocs = [disk("both.md", "disk-line-1\ndisk-line-2", 9000)];
    const diskAssets = [{ path: "notes/assets/keep.png", mtime: 1, size: 10 }];
    const changes = detectExternalChanges(
      library,
      assets,
      diskDocs,
      diskAssets,
      index,
    );
    const conflict = changes.find((c) => c.path === "both.md");
    expect(conflict?.change).toBe("conflict");
    expect(conflict?.libraryExcerpt).toContain("lib-line-1");
    expect(conflict?.diskExcerpt).toContain("disk-line-1");

    const gone = changes.find((c) => c.path === "notes/assets/gone.png");
    expect(gone).toEqual(
      expect.objectContaining({ entity: "asset", change: "delete" }),
    );

    // Unchecked delete must not remove the asset
    const withoutDelete = changes.filter((c) => c.change !== "delete");
    const pulled = applyExternalPull(
      library,
      assets,
      diskDocs,
      [],
      index,
      withoutDelete,
    );
    expect(pulled.assets.some((a) => a.path === "notes/assets/gone.png")).toBe(
      true,
    );
    expect(pulled.skippedConflicts).toEqual(["both.md"]);

    // Checked delete removes asset meta from the pull result
    const withDelete = applyExternalPull(
      library,
      assets,
      diskDocs,
      [],
      index,
      changes.filter((c) => c.change === "delete"),
    );
    expect(withDelete.assets.some((a) => a.path === "notes/assets/gone.png")).toBe(
      false,
    );
    expect(withDelete.assets.some((a) => a.path === "notes/assets/keep.png")).toBe(
      true,
    );
  });
});

describe("mirrored-only asset deletes (patch 0)", () => {
  const png = (path: string): AssetMeta => ({
    id: `id-${path}`,
    path,
    mime: "image/png",
    size: 10,
    createdAt: 1000,
  });

  it("does not report delete when library has png but index has no asset entry", () => {
    const assets = [png("notes/assets/never-mirrored.png")];
    // Old version:1 shape — documents only, no assets field
    const index = normalizeFsIndex({
      format: "langhuan-fs-index",
      version: 1,
      updatedAt: 1,
      documents: {},
    });
    expect(index.assets).toEqual({});
    const changes = detectExternalChanges([], assets, [], [], index);
    expect(changes.find((c) => c.path === "notes/assets/never-mirrored.png")).toBeUndefined();
    expect(changes.some((c) => c.entity === "asset" && c.change === "delete")).toBe(false);
  });

  it("reports delete when index has the asset record and disk is missing", () => {
    const assets = [png("notes/assets/was-mirrored.png")];
    const index = markAssetsSynced(emptyIndex(), ["notes/assets/was-mirrored.png"], 2000);
    const changes = detectExternalChanges([], assets, [], [], index);
    expect(changes).toEqual([
      expect.objectContaining({
        path: "notes/assets/was-mirrored.png",
        entity: "asset",
        change: "delete",
      }),
    ]);
  });

  it("leaves library asset in place when delete stays unchecked", () => {
    const assets = [png("notes/assets/was-mirrored.png")];
    const index = markAssetsSynced(emptyIndex(), ["notes/assets/was-mirrored.png"], 2000);
    const changes = detectExternalChanges([], assets, [], [], index);
    expect(changes).toHaveLength(1);
    // Simulate UI default: deletes unchecked → selected list empty
    const pulled = applyExternalPull([], assets, [], [], index, []);
    expect(pulled.assets.some((a) => a.path === "notes/assets/was-mirrored.png")).toBe(true);

    // Confirmed delete also drops the mirror record from the index helper
    const after = buildIndexAfterExternalPull(index, [], changes, [], 5000);
    expect(after.assets?.["notes/assets/was-mirrored.png"]).toBeUndefined();
  });
});

describe("applyDiskOverwrite", () => {
  it("overwrites only listed conflict paths; selected conflict still skips", () => {
    const library: Document[] = [
      doc({ id: "1", path: "both.md", content: "lib-both", updatedAt: 8000 }),
      doc({ id: "2", path: "other.md", content: "lib-other", updatedAt: 8000 }),
      doc({ id: "3", path: "disk-newer.md", content: "old", updatedAt: 2000 }),
    ];
    const index = buildIndexFromDocuments(library, 3000);
    const diskDocs: DiskDoc[] = [
      disk("both.md", "disk-both", 9000),
      disk("other.md", "disk-other", 9000),
      disk("disk-newer.md", "fresh", 9000),
    ];
    const changes = detectExternalChanges(library, [], diskDocs, [], index);
    expect(changes.find((c) => c.path === "both.md")?.change).toBe("conflict");
    expect(changes.find((c) => c.path === "other.md")?.change).toBe("conflict");

    // Checkbox-selected conflicts are still skipped by applyExternalPull
    const pulled = applyExternalPull(library, [], diskDocs, [], index, changes);
    expect(pulled.skippedConflicts).toEqual(expect.arrayContaining(["both.md", "other.md"]));
    expect(pulled.documents.find((d) => d.path === "both.md")?.content).toBe("lib-both");

    // Explicit overwrite list covers only both.md
    const over = applyDiskOverwrite(library, diskDocs, ["both.md"], 12_000);
    expect(over.overwritten).toEqual(["both.md"]);
    expect(over.documents.find((d) => d.path === "both.md")?.content).toBe("disk-both");
    expect(over.documents.find((d) => d.path === "both.md")?.updatedAt).toBe(12_000);
    expect(over.documents.find((d) => d.path === "other.md")?.content).toBe("lib-other");
    expect(over.errors).toEqual([]);

    const patched = patchIndexAfterDiskOverwrite(index, over.documents, over.overwritten, 12_000);
    expect(patched.documents["both.md"]?.lastSyncedAt).toBe(12_000);
    expect(patched.documents["both.md"]?.updatedAt).toBe(12_000);
    expect(patched.documents["other.md"]?.lastSyncedAt).toBe(3000);
  });
});
