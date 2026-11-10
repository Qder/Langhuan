/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { parseLibraryZipDetailed, backupHasBlockingIssues, buildLibraryZipDetailed } from "./backup";
import { payloadToBackupTree } from "./backupTree";
import { completeBackupFixture } from "./backupTestFixtures";
vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(),
  putAssetBlob: vi.fn(),
  base64ToBlob: (s: string, mime: string) =>
    new Blob([Buffer.from(s, "base64")], { type: mime }),
  blobToBase64: async (b: Blob) =>
    Buffer.from(await b.arrayBuffer()).toString("base64"),
}));
describe("legacy backups", () => {
  it.each([1, 2])(
    "imports v%s without new learning fields and normalizes older annotation/quiz fields",
    async (version) => {
      const zip = new JSZip();
      zip.file("langhuan-backup/files/a.md", "old content");
      zip.file(
        "langhuan-backup/manifest.json",
        JSON.stringify({
          format: "langhuan-backup",
          version,
          documents: [
            { id: "old", path: "a.md", type: "md", createdAt: 1, updatedAt: 2 },
          ],
          annotations: [
            { id: "ann", docId: "old", quote: "old", start: 0, end: 3 },
          ],
          quizDocs: [
            { docId: "old", items: [{ id: "q", stem: "why", state: "know" }] },
          ],
        }),
      );
      const parsed = await parseLibraryZipDetailed(
        new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
      );
      expect(parsed.legacy).toBe(true);
      expect(backupHasBlockingIssues(parsed.report)).toBe(false);
      expect(parsed.payload.versions).toEqual({});
      expect(parsed.payload.readingProgress).toEqual({});
      expect(parsed.payload.annotations?.[0].plainOffset).toBe(0);
      expect(parsed.payload.quizDocs?.[0].items[0].updatedAt).toBe(0);
      expect(() => payloadToBackupTree(parsed.payload)).not.toThrow();
    },
  );
  it("accepts legacy sidecar arrays and loose text/image ZIP trees", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: "langhuan-backup",
        version: 2,
        documents: [
          { id: "d", path: "a.md", type: "md", createdAt: 1, updatedAt: 1 },
        ],
      }),
    );
    zip.file("files/a.md", "hello");
    zip.file(
      "annotations.json",
      JSON.stringify([
        { id: "a", docId: "d", quote: "hello", start: 0, end: 5 },
      ]),
    );
    zip.file(
      "quiz.json",
      JSON.stringify({
        docs: [
          { docId: "d", items: [{ id: "q", stem: "what", state: "unseen" }] },
        ],
      }),
    );
    const parsed = await parseLibraryZipDetailed(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
    );
    expect(parsed.payload.annotations).toHaveLength(1);
    expect(parsed.payload.quizDocs).toHaveLength(1);
    expect(() => payloadToBackupTree(parsed.payload)).not.toThrow();
    const loose = new JSZip();
    loose.file("root/note.txt", "text");
    loose.file("root/image.png", new Uint8Array([1, 2]));
    const result = await parseLibraryZipDetailed(
      new Blob([await loose.generateAsync({ type: "arraybuffer" })]),
    );
    expect(result.payload.documents[0].path).toBe("note.md");
    expect(result.payload.assetBinaries).toBeDefined();
  });
});

it("supports v2 sanitized filenames/trash IDs and preserves BOM/newlines exactly", async () => {
  const zip = new JSZip();
  const body = "\ufeff正文\r\nnext\n";
  zip.file("langhuan-backup/files/notes/a_b.md", body);
  zip.file("langhuan-backup/files/_trash/id/x__deleted_md", "trash");
  zip.file(
    "langhuan-backup/manifest.json",
    JSON.stringify({
      format: "langhuan-backup",
      version: 2,
      documents: [
        {
          id: "d",
          path: "notes/a..b.md",
          type: "md",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      trash: [
        {
          deletedAt: 2,
          doc: {
            id: "id/x",
            path: "deleted..md",
            type: "md",
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ],
    }),
  );
  const parsed = await parseLibraryZipDetailed(
    new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
  );
  expect(parsed.payload.documents[0].content).toBe(body);
  expect(parsed.payload.trash[0].doc.content).toBe("trash");
  expect(backupHasBlockingIssues(parsed.report)).toBe(false);
  const tree = payloadToBackupTree(parsed.payload);
  expect(
    Buffer.from(
      tree.files.find((f) => f.path === "notes/a..b.md")!.base64,
      "base64",
    ).toString("utf8"),
  ).toBe(body);
});

it("preserves opaque record IDs without prototype-key collisions", async () => {
  const { completeBackupFixture } = await import("./backupTestFixtures");
  const { buildLibraryZipDetailed } = await import("./backup");
  const p = completeBackupFixture();
  const oldVersion = p.versions!.d1[0];
  p.documents[0].id = "__proto__";
  p.annotations![0].docId = "__proto__";
  p.quizDocs![0].docId = "__proto__";
  p.assets![0].id = "constructor";
  p.assets![0].docId = "__proto__";
  p.assetBinaries = Object.fromEntries([["constructor", "iVBORw=="]]);
  p.versions = Object.fromEntries([
    ["__proto__", [{ ...oldVersion, docId: "__proto__" }]],
  ]);
  const built = await buildLibraryZipDetailed(p);
  const parsed = await parseLibraryZipDetailed(built.blob);
  expect(parsed.report.ok).toBe(true);
  expect(Object.hasOwn(parsed.payload.versions!, "__proto__")).toBe(true);
  expect(parsed.payload.assetBinaries!.constructor).toBe("iVBORw==");
  expect(() => payloadToBackupTree(parsed.payload)).not.toThrow();
});

describe("topics backup compatibility", () => {
  it("new v3 export includes topics and export-then-restore round-trips them", async () => {
    const source = completeBackupFixture();
    const built = await buildLibraryZipDetailed(source);
    expect(built.report.ok).toBe(true);
    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    const manifest = JSON.parse(
      await zip.file("langhuan-backup/manifest.json")!.async("string"),
    );
    expect(manifest.learningFiles).toContain("learning/topics.json");
    const parsed = await parseLibraryZipDetailed(built.blob);
    expect(parsed.report.ok).toBe(true);
    expect(parsed.payload.topics).toEqual(source.topics);
  });

  it("v3 zip without topics still imports with empty topics", async () => {
    const source = completeBackupFixture();
    const built = await buildLibraryZipDetailed(source);
    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    zip.remove("langhuan-backup/learning/topics.json");
    const manifest = JSON.parse(
      await zip.file("langhuan-backup/manifest.json")!.async("string"),
    );
    manifest.learningFiles = (manifest.learningFiles as string[]).filter(
      (n) => n !== "learning/topics.json",
    );
    delete manifest.entryDigests["learning/topics.json"];
    zip.file("langhuan-backup/manifest.json", JSON.stringify(manifest));
    const parsed = await parseLibraryZipDetailed(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
    );
    expect(backupHasBlockingIssues(parsed.report)).toBe(false);
    expect(parsed.payload.topics ?? []).toEqual([]);
    expect(() => payloadToBackupTree(parsed.payload)).not.toThrow();
  });
});
