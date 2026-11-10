/** @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  buildLibraryZipDetailed,
  parseLibraryZipDetailed,
  backupHasBlockingIssues,
} from "./backup";
import {
  snapshotBackupLibrary,
  stageBackupLibrary,
  applyStagedBackup,
  storeAutomaticBackup,
  listAutomaticBackups,
  readBackupRestoreState,
  readStagedBackup,
  listProjectRoots,
  readCssIndexes,
  readJsIndexes,
  readProjectSnapshot,
} from "./contentFs";
import {
  payloadToBackupTree,
  payloadFromBackupTree,
  mergeBackupPayload,
  backupConflicts,
} from "./backupTree";
import { completeBackupFixture, backupDoc } from "./backupTestFixtures";
import { textBase64 } from "./backupProtocol";
vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(async () => null),
  putAssetBlob: vi.fn(),
  base64ToBlob: (s: string, mime: string) =>
    new Blob([Buffer.from(s, "base64")], { type: mime }),
  blobToBase64: async (b: Blob) =>
    Buffer.from(await b.arrayBuffer()).toString("base64"),
}));
const cwd = process.cwd();
let home: string;
let root: string;
async function seed() {
  const tree = payloadToBackupTree(completeBackupFixture());
  for (const f of tree.files) {
    const abs = path.join(root, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(f.base64, "base64"));
  }
}
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "langhuan-backup-"));
  process.chdir(home);
  root = path.join(home, "content");
  await seed();
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  await fs.rm(home, { recursive: true, force: true });
});
describe("isolated complete backup", () => {
  it("round-trips primary files including every learning family, assets missing from IDB, and trash", async () => {
    const before = await snapshotBackupLibrary();
    const source = payloadFromBackupTree(before);
    const built = await buildLibraryZipDetailed(source);
    expect(built.report.ok).toBe(true);
    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    const manifest = JSON.parse(
      await zip.file("langhuan-backup/manifest.json")!.async("string"),
    );
    expect(manifest.version).toBe(3);
    expect(manifest.learningFiles).toContain("learning/versions/d1.json");
    expect(manifest.learningFiles).toContain("learning/topics.json");
    const parsed = await parseLibraryZipDetailed(built.blob);
    expect(parsed.report.ok).toBe(true);
    expect(parsed.payload.annotations).toEqual(source.annotations);
    expect(parsed.payload.quizDocs).toEqual(source.quizDocs);
    expect(parsed.payload.versions).toEqual(source.versions);
    expect(parsed.payload.savedSearches).toEqual(source.savedSearches);
    expect(parsed.payload.readingProgress).toEqual(source.readingProgress);
    expect(parsed.payload.topics).toEqual(source.topics);
    expect(parsed.payload.assetBinaries).toEqual(source.assetBinaries);
    expect(parsed.payload.trash).toEqual(source.trash);
    const stage = await stageBackupLibrary(
      payloadToBackupTree(parsed.payload),
      "replace",
      before.fingerprint,
    );
    expect(await snapshotBackupLibrary()).toEqual(before);
    expect(
      payloadFromBackupTree(await readStagedBackup(stage.id)).versions,
    ).toEqual(source.versions);
    expect(await fs.readFile(path.join(stage.path, "notes/a.md"), "utf8")).toBe(
      source.documents[0].content,
    );
    const applied = await applyStagedBackup(stage.id);
    expect(
      await fs.readFile(path.join(applied.archive, "notes/a.md"), "utf8"),
    ).toBe(source.documents[0].content);
    const restored = payloadFromBackupTree(await snapshotBackupLibrary());
    expect(restored.versions).toEqual(source.versions);
    expect(restored.readingProgress).toEqual(source.readingProgress);
    expect(restored.assetBinaries).toEqual(source.assetBinaries);
    expect((await readBackupRestoreState())?.generation).toBe(stage.id);
  });
  it("replace removes old-only files from live but preserves their only copy in the old root", async () => {
    const before = await snapshotBackupLibrary();
    const stage = await stageBackupLibrary(
      payloadToBackupTree({
        documents: [backupDoc("new", "new.md", "new")],
        trash: [],
      }),
      "replace",
      before.fingerprint,
    );
    expect(await snapshotBackupLibrary()).toEqual(before);
    const result = await applyStagedBackup(stage.id);
    await expect(
      fs.readFile(path.join(root, "notes/a.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs.readFile(path.join(result.archive, "notes/assets/p.png")),
    ).toEqual(Buffer.from("iVBORw==", "base64"));
    expect(await fs.readFile(path.join(root, "new.md"), "utf8")).toBe("new");
  });
  it("merge preserves old-only notes and remaps conflicting IDs and their citations", async () => {
    const before = await snapshotBackupLibrary();
    const incoming = completeBackupFixture();
    incoming.documents[0].path = "other.md";
    incoming.documents[0].content = "other";
    incoming.annotations![0].path = "other.md";
    incoming.assets = [];
    incoming.assetBinaries = {};
    const merged = mergeBackupPayload(payloadFromBackupTree(before), incoming);
    const newDoc = merged.documents.find((d) => d.path === "other.md")!;
    expect(newDoc.id).not.toBe("d1");
    expect(merged.annotations?.some((a) => a.docId === "d1")).toBe(true);
    expect(merged.annotations?.some((a) => a.docId === newDoc.id)).toBe(true);
    expect(merged.quizDocs?.some((d) => d.docId === newDoc.id)).toBe(true);
    expect(merged.versions?.[newDoc.id][0].docId).toBe(newDoc.id);
    const staged = await stageBackupLibrary(
      payloadToBackupTree(merged),
      "merge",
      before.fingerprint,
    );
    await applyStagedBackup(staged.id);
    expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toContain(
      "study",
    );
    expect(await fs.readFile(path.join(root, "other.md"), "utf8")).toBe(
      "other",
    );
  });
  it("missing/corrupt preview and conflicts never mutate destination or cache", async () => {
    const before = await snapshotBackupLibrary();
    const built = await buildLibraryZipDetailed(completeBackupFixture());
    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    zip.remove("langhuan-backup/files/notes/assets/p.png");
    zip.file("langhuan-backup/learning/reading-progress.json", "broken");
    zip.file("langhuan-backup/files/notes/a.md", "changed");
    const parsed = await parseLibraryZipDetailed(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
    );
    expect(parsed.report.issues.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        "missing-asset-in-zip",
        "entry-digest-mismatch",
        "corrupt-metadata",
      ]),
    );
    expect(backupHasBlockingIssues(parsed.report)).toBe(true);
    expect(backupConflicts(completeBackupFixture(), parsed.payload)).toContain(
      "notes/a.md",
    );
    expect(await snapshotBackupLibrary()).toEqual(before);
    const { putAssetBlob } = await import("../assets/store");
    expect(putAssetBlob).not.toHaveBeenCalled();
  });
  it("staging write failure leaves primary intact", async () => {
    const before = await snapshotBackupLibrary();
    const write = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(
      async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).includes(`${path.sep}stages${path.sep}`))
          throw new Error("disk full");
        return write(...args);
      },
    );
    await expect(
      stageBackupLibrary(
        payloadToBackupTree(completeBackupFixture()),
        "replace",
        before.fingerprint,
      ),
    ).rejects.toThrow("disk full");
    expect(await snapshotBackupLibrary()).toEqual(before);
  });
  it("failed root install rolls back before allowing another normal operation", async () => {
    const before = await snapshotBackupLibrary();
    const stage = await stageBackupLibrary(
      payloadToBackupTree({ documents: [], trash: [] }),
      "replace",
      before.fingerprint,
    );
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(from) === stage.path) throw new Error("install failed");
      return rename(from, to);
    });
    await expect(applyStagedBackup(stage.id)).rejects.toThrow("install failed");
    expect(await snapshotBackupLibrary()).toEqual(before);
  });
  it("rejects changed primary and corrupt isolated copy without replacing good files", async () => {
    const before = await snapshotBackupLibrary();
    const stage = await stageBackupLibrary(
      payloadToBackupTree(completeBackupFixture()),
      "replace",
      before.fingerprint,
    );
    await fs.writeFile(path.join(stage.path, "notes/a.md"), "corrupt");
    await expect(readStagedBackup(stage.id)).rejects.toThrow("隔离副本");
    await expect(applyStagedBackup(stage.id)).rejects.toThrow("隔离副本");
    expect(await snapshotBackupLibrary()).toEqual(before);
    const second = await stageBackupLibrary(
      payloadToBackupTree(completeBackupFixture()),
      "replace",
      before.fingerprint,
    );
    await fs.writeFile(path.join(root, "notes/a.md"), "newer edit");
    await expect(applyStagedBackup(second.id)).rejects.toThrow("主库");
    expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toBe(
      "newer edit",
    );
  });
  it("cold-start recovery restores old root after an interrupted first rename", async () => {
    const before = await snapshotBackupLibrary();
    const recovery = path.join(home, ".content-recovery");
    await fs.mkdir(path.join(recovery, "archives"), { recursive: true });
    await fs.rename(root, path.join(recovery, "archives", "interrupted"));
    await fs.writeFile(
      path.join(recovery, "pending.json"),
      JSON.stringify({ id: "interrupted" }),
    );
    expect(await snapshotBackupLibrary()).toEqual(before);
    await expect(
      fs.stat(path.join(recovery, "pending.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps N newest managed ZIPs and never rotates archives/stages or on bad/write-failed ZIP", async () => {
    const built = await buildLibraryZipDetailed(completeBackupFixture());
    const encoded = Buffer.from(await built.blob.arrayBuffer()).toString(
      "base64",
    );
    for (let i = 0; i < 4; i++) await storeAutomaticBackup(encoded, 2);
    const before = await listAutomaticBackups();
    expect(before).toHaveLength(2);
    expect(before[0].createdAt).toBeGreaterThan(before[1].createdAt);
    await expect(
      storeAutomaticBackup(Buffer.from("PKbad").toString("base64"), 1),
    ).rejects.toThrow();
    expect(await listAutomaticBackups()).toEqual(before);
    const notABackup = new JSZip();
    notABackup.file("unrelated.txt", "not a library");
    await expect(
      storeAutomaticBackup(
        Buffer.from(
          await notABackup.generateAsync({ type: "uint8array" }),
        ).toString("base64"),
        1,
      ),
    ).rejects.toThrow("清单");
    const incomplete = await JSZip.loadAsync(await built.blob.arrayBuffer());
    incomplete.remove("langhuan-backup/learning/reading-progress.json");
    await expect(
      storeAutomaticBackup(
        Buffer.from(
          await incomplete.generateAsync({ type: "uint8array" }),
        ).toString("base64"),
        1,
      ),
    ).rejects.toThrow("缺失");
    expect(await listAutomaticBackups()).toEqual(before);
    const write = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(
      async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).includes(`${path.sep}backups${path.sep}`))
          throw new Error("full");
        return write(...args);
      },
    );
    await expect(storeAutomaticBackup(encoded, 1)).rejects.toThrow("full");
    expect(await listAutomaticBackups()).toEqual(before);
  });
  it("rejects traversal and corrupt learning input before stage or live writes", async () => {
    const before = await snapshotBackupLibrary();
    const tree = payloadToBackupTree(completeBackupFixture());
    tree.files.push({ path: "../escape.md", base64: textBase64("bad") });
    await expect(
      stageBackupLibrary(tree, "replace", before.fingerprint),
    ).rejects.toThrow("路径");
    expect(await snapshotBackupLibrary()).toEqual(before);
    const corrupt = payloadToBackupTree(completeBackupFixture());
    corrupt.files.find((f) =>
      f.path.endsWith("reading-progress.json"),
    )!.base64 = textBase64("{}");
    await expect(
      stageBackupLibrary(corrupt, "replace", before.fingerprint),
    ).rejects.toThrow();
    expect(await snapshotBackupLibrary()).toEqual(before);
  });
  it("unindexed primary text is reported rather than silently excluded", async () => {
    await fs.writeFile(path.join(root, "outside-index.md"), "unique");
    const snapshot = await snapshotBackupLibrary();
    expect(() => payloadFromBackupTree(snapshot)).toThrow("索引外正文");
  });
});

it("normal project/index reads cannot recreate live root in the rename gap", async () => {
  const before = await snapshotBackupLibrary();
  const stage = await stageBackupLibrary(
    payloadToBackupTree(completeBackupFixture()),
    "replace",
    before.fingerprint,
  );
  const rename = fs.rename.bind(fs);
  let reads: Promise<unknown> | undefined;
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (String(from) === stage.path) {
      reads = Promise.all([
        listProjectRoots(),
        readProjectSnapshot(),
        readCssIndexes(),
        readJsIndexes(),
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
    return rename(from, to);
  });
  await applyStagedBackup(stage.id);
  await reads;
  expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toContain(
    "study",
  );
});

it("can repair a corrupt live learning file by explicit replace while archiving its unreadable bytes", async () => {
  await fs.writeFile(
    path.join(root, ".langhuan/annotations.json"),
    "broken original bytes",
  );
  const before = await snapshotBackupLibrary();
  const stage = await stageBackupLibrary(
    payloadToBackupTree(completeBackupFixture()),
    "replace",
    before.fingerprint,
  );
  expect(await snapshotBackupLibrary()).toEqual(before);
  const applied = await applyStagedBackup(stage.id);
  expect(
    await fs.readFile(
      path.join(applied.archive, ".langhuan/annotations.json"),
      "utf8",
    ),
  ).toBe("broken original bytes");
  expect(
    payloadFromBackupTree(await snapshotBackupLibrary()).annotations,
  ).toEqual(completeBackupFixture().annotations);
});
