/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  buildLibraryZip,
  parseLibraryZip,
  type BackupPayload,
} from "./backup";
import type { Document } from "../types";

vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(async () => null),
  putAssetBlob: vi.fn(async () => undefined),
  base64ToBlob: vi.fn(),
  blobToBase64: vi.fn(async () => ""),
}));

function doc(partial: Partial<Document> & Pick<Document, "path" | "content">): Document {
  return {
    id: partial.id || `id_${partial.path}`,
    path: partial.path,
    type: partial.type || (partial.path.endsWith(".html") ? "html" : "md"),
    content: partial.content,
    starred: partial.starred ?? false,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
  };
}

describe("buildLibraryZip / parseLibraryZip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("export keeps nested directories in zip", async () => {
    const payload: BackupPayload = {
      documents: [
        doc({ path: "notes/deep/a.md", content: "# A\n" }),
        doc({ path: "root.md", content: "root\n" }),
      ],
      trash: [],
    };
    const blob = await buildLibraryZip(payload);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.endsWith("files/notes/deep/a.md"))).toBe(true);
    expect(names.some((n) => n.endsWith("files/root.md"))).toBe(true);
    expect(names.some((n) => n.endsWith("manifest.json"))).toBe(true);
  });

  it("parse round-trip restores nested paths (merge-ready payload)", async () => {
    const payload: BackupPayload = {
      documents: [
        doc({ id: "keep", path: "keep.md", content: "k" }),
        doc({ id: "nested", path: "dir/x.md", content: "x" }),
      ],
      trash: [],
    };
    const blob = await buildLibraryZip(payload);
    const parsed = await parseLibraryZip(blob);
    expect(parsed.documents.map((d) => d.path).sort()).toEqual(["dir/x.md", "keep.md"]);
    expect(parsed.documents.find((d) => d.path === "dir/x.md")?.content).toBe("x");
  });

  it("parse supports full-replace shaped payload including trash", async () => {
    const payload: BackupPayload = {
      documents: [doc({ id: "only", path: "only.md", content: "o" })],
      trash: [
        {
          deletedAt: 9,
          doc: doc({ id: "gone", path: "gone.md", content: "g" }),
        },
      ],
    };
    const blob = await buildLibraryZip(payload);
    const parsed = await parseLibraryZip(blob);
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0]?.path).toBe("only.md");
    expect(parsed.trash).toHaveLength(1);
    expect(parsed.trash[0]?.doc.path).toBe("gone.md");
    expect(parsed.trash[0]?.doc.content).toBe("g");
  });

  it("parse fails on wrong manifest format", async () => {
    const zip = new JSZip();
    zip.file(
      "langhuan-backup/manifest.json",
      JSON.stringify({ format: "not-langhuan", version: 2, documents: [] })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    await expect(parseLibraryZip(blob)).rejects.toThrow(/不是琅嬛备份包/);
  });

  it("parse fails when zip has no importable files", async () => {
    const zip = new JSZip();
    zip.file("readme.pdf", "hello");
    const blob = await zip.generateAsync({ type: "blob" });
    await expect(parseLibraryZip(blob)).rejects.toThrow(/没有可导入/);
  });
});
