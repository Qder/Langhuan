/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  buildLibraryZipDetailed,
  parseLibraryZipDetailed,
  verifyBackupPayload,
  formatBackupIntegritySummary,
  type BackupPayload,
} from "./backup";
import { sha256Hex } from "./backupIntegrity";
import type { Document } from "../types";

const blobs = new Map<string, Blob>();

vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(async (id: string) => blobs.get(id) ?? null),
  putAssetBlob: vi.fn(async (id: string, blob: Blob) => {
    blobs.set(id, blob);
  }),
  base64ToBlob: vi.fn(),
  blobToBase64: vi.fn(async () => ""),
}));

function doc(partial: Partial<Document> & Pick<Document, "path" | "content">): Document {
  return {
    id: partial.id || `id_${partial.path}`,
    path: partial.path,
    type: partial.type || "md",
    content: partial.content,
    starred: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("backup integrity", () => {
  beforeEach(() => {
    blobs.clear();
    vi.clearAllMocks();
  });

  it("verifyBackupPayload flags empty docs and orphan annotations", () => {
    const report = verifyBackupPayload({
      documents: [doc({ id: "d1", path: "a.md", content: "" })],
      trash: [],
      annotations: [
        {
          id: "ann1",
          docId: "missing",
          path: "x.md",
          quote: "q",
          note: "",
          start: 0,
          end: 1,
          plainOffset: 0,
          contextBefore: "",
          contextAfter: "",
          color: "cinnabar",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "empty-document")).toBe(true);
    expect(report.issues.some((i) => i.kind === "orphan-annotation")).toBe(true);
    expect(formatBackupIntegritySummary(report)).toMatch(/有问题/);
  });

  it("round-trip notes+image+annotation with digests", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], {
      type: "image/png",
    });
    blobs.set("asset1", png);
    const payload: BackupPayload = {
      documents: [
        doc({
          id: "d1",
          path: "notes/a.md",
          content: "hello ![x](./assets/shot.png)\n",
        }),
      ],
      trash: [],
      assets: [
        {
          id: "asset1",
          path: "notes/assets/shot.png",
          mime: "image/png",
          size: png.size,
          createdAt: 1,
          docId: "d1",
        },
      ],
      annotations: [
        {
          id: "ann1",
          docId: "d1",
          path: "notes/a.md",
          quote: "hello",
          note: "n",
          start: 0,
          end: 5,
          plainOffset: 0,
          contextBefore: "",
          contextAfter: "",
          color: "teal",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const { blob, report } = await buildLibraryZipDetailed(payload);
    expect(report.ok).toBe(true);
    expect(report.assetsRestored).toBe(1);
    expect(report.annotations).toBe(1);

    blobs.clear();
    const parsed = await parseLibraryZipDetailed(blob);
    expect(parsed.report.ok).toBe(true);
    expect(parsed.payload.documents[0]?.content).toContain("hello");
    expect(parsed.payload.assets).toHaveLength(1);
    expect(parsed.payload.annotations).toHaveLength(1);
    expect(blobs.has("asset1")).toBe(true);
  });

  it("flags missing asset binary in zip vs manifest", async () => {
    const zip = new JSZip();
    const folder = zip.folder("langhuan-backup")!;
    folder.file("files/a.md", "# A\n");
    folder.file(
      "manifest.json",
      JSON.stringify({
        format: "langhuan-backup",
        version: 2,
        exportedAt: 1,
        app: "琅嬛",
        documents: [
          {
            id: "d1",
            path: "a.md",
            type: "md",
            starred: false,
            createdAt: 1,
            updatedAt: 1,
            tags: [],
          },
        ],
        assets: [
          {
            id: "gone",
            path: "assets/x.png",
            mime: "image/png",
            size: 3,
            createdAt: 1,
          },
        ],
        annotations: [],
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const { report } = await parseLibraryZipDetailed(blob);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "missing-asset-in-zip")).toBe(
      true
    );
  });

  it("sha256Hex is stable across Blob / Uint8Array / ArrayBuffer / subarray", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const a = await sha256Hex(new Blob([payload]));
    const b = await sha256Hex(payload);
    const c = await sha256Hex(payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength
    ));
    // Non-zero offset view (Node Buffer pools / subarray) must not throw.
    const padded = new Uint8Array([0xff, 1, 2, 3, 0xff]);
    const view = padded.subarray(1, 4);
    const d = await sha256Hex(view);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
