import { describe, expect, it } from "vitest";
import { findOrphanAssets } from "./orphanAssets";
import type { AssetMeta, Document } from "../types";

function doc(path: string, content: string): Document {
  return {
    id: path,
    path,
    type: "md",
    content,
    starred: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function asset(path: string, id = path): AssetMeta {
  return { id, path, mime: "image/png", size: 1, createdAt: 1 };
}

describe("findOrphanAssets", () => {
  it("keeps referenced, lists unused", () => {
    const docs = [
      doc("notes/a.md", "![x](./assets/keep.png)\n"),
      doc("notes/b.md", "no images"),
    ];
    const assets = [
      asset("notes/assets/keep.png", "k"),
      asset("notes/assets/orphan.png", "o"),
    ];
    const orphans = findOrphanAssets(docs, assets);
    expect(orphans.map((a) => a.id)).toEqual(["o"]);
  });
});
