/** @vitest-environment node */
import { beforeEach, it, expect, vi } from "vitest";
import { collectBackup } from "./backupService";
import { fetchBackupSnapshot } from "./backupApi";
import { keys, set } from "idb-keyval";
import { getAssetBlob, putAssetBlob } from "../assets/store";
import { payloadToBackupTree } from "./backupTree";
import { completeBackupFixture } from "./backupTestFixtures";
vi.mock("./backupApi", () => ({ fetchBackupSnapshot: vi.fn() }));
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  keys: vi.fn(async () => []),
  set: vi.fn(),
}));
vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(async () => null),
  putAssetBlob: vi.fn(),
  blobToBase64: async (b: Blob) =>
    Buffer.from(await b.arrayBuffer()).toString("base64"),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(keys).mockResolvedValue([]);
});
it("reads primary binaries/learning before stale caches without writing on preview", async () => {
  const fixture = completeBackupFixture();
  const tree = payloadToBackupTree(fixture);
  vi.mocked(fetchBackupSnapshot).mockResolvedValue({
    ...tree,
    fingerprint: "f",
    root: "temp",
  });
  const fallback = completeBackupFixture();
  fallback.documents[0].content = "stale";
  fallback.assetBinaries = { image: "YmFk" };
  const result = await collectBackup(fallback);
  expect(result.payload.documents[0].content).toBe(
    fixture.documents[0].content,
  );
  expect(result.payload.assetBinaries).toEqual(fixture.assetBinaries);
  expect(result.payload.versions).toEqual(fixture.versions);
  expect(set).not.toHaveBeenCalled();
  expect(putAssetBlob).not.toHaveBeenCalled();
  expect(getAssetBlob).not.toHaveBeenCalled();
});
it("falls back to old-store docs/assets/trash and reads missing primary bytes without filling IDB", async () => {
  vi.mocked(fetchBackupSnapshot).mockResolvedValue({
    files: [],
    fingerprint: "empty",
    root: "temp",
  });
  const fallback = completeBackupFixture();
  fallback.assetBinaries = {};
  vi.mocked(getAssetBlob).mockResolvedValueOnce(
    new Blob([new Uint8Array([1, 2])]),
  );
  const result = await collectBackup(fallback);
  expect(result.payload.documents).toEqual(fallback.documents);
  expect(result.payload.trash).toEqual(fallback.trash);
  expect(result.payload.assets).toEqual(fallback.assets);
  expect(result.payload.assetBinaries?.image).toBe("AQI=");
  expect(set).not.toHaveBeenCalled();
  expect(putAssetBlob).not.toHaveBeenCalled();
});
it("fails closed on corrupt learning files or unreadable old history rather than declaring an empty complete backup", async () => {
  const tree = payloadToBackupTree(completeBackupFixture());
  tree.files.find((f) => f.path.endsWith("annotations.json"))!.base64 = "e30=";
  vi.mocked(fetchBackupSnapshot).mockResolvedValue({
    ...tree,
    fingerprint: "f",
    root: "temp",
  });
  await expect(collectBackup(completeBackupFixture())).rejects.toThrow();
  vi.mocked(fetchBackupSnapshot).mockResolvedValue({
    ...payloadToBackupTree(completeBackupFixture()),
    fingerprint: "f",
    root: "temp",
  });
  vi.mocked(keys).mockRejectedValueOnce(new Error("IDB unreadable"));
  await expect(collectBackup(completeBackupFixture())).rejects.toThrow(
    "未将不确定数据标为完整备份",
  );
  expect(set).not.toHaveBeenCalled();
});

it("previews metadata-only conflicts even when note bodies match", async () => {
  const { backupConflicts } = await import("./backupTree");
  const base = completeBackupFixture();
  const incoming = completeBackupFixture();
  incoming.readingProgress!["notes/a.md"].top = 100;
  incoming.quizDocs![0].items[0].state = "dont_know";
  expect(backupConflicts(base, incoming)).toEqual(
    expect.arrayContaining([
      ".langhuan/reading-progress.json#notes/a.md",
      ".langhuan/quiz.json#d1",
    ]),
  );
});
