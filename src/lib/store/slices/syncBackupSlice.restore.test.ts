/** @vitest-environment node */
import { beforeEach, it, expect, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createSyncBackupSlice } from "./syncBackupSlice";
import type { LanghuanState } from "../types";
import { backupDoc } from "../../storage/backupTestFixtures";
import { fetchBackupRestoreState } from "../../storage/backupApi";
import { bulkWriteLibrary } from "../../storage/contentApi";
import { takeIdbLibrary } from "../../storage/contentMigration";
vi.mock("../../storage/backupApi", () => ({
  fetchBackupRestoreState: vi.fn(async () => null),
}));
vi.mock("../../storage/contentApi", () => ({
  fetchLibrary: vi.fn(async () => ({ documents: [], assets: [], trash: [] })),
  bulkWriteLibrary: vi.fn(async (x) => ({
    documents: x.documents ?? [],
    assets: [],
    trash: [],
  })),
  blobToBase64: vi.fn(),
}));
vi.mock("../../storage/learningPersistence", () => ({
  hydrateLearningState: vi.fn(async () => {}),
}));
vi.mock("../../storage/contentMigration", () => ({
  takeIdbLibrary: vi.fn(() => null),
}));
vi.mock("../../storage/usage", () => ({
  computeStorageUsage: vi.fn(async () => null),
  measureLibraryBytes: vi.fn(() => 0),
}));
vi.mock("../../assets/store", () => ({ saveAssetMetaList: vi.fn() }));
vi.mock("../../storage/versions", () => ({ clearVersions: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchBackupRestoreState).mockResolvedValue(null);
  vi.mocked(takeIdbLibrary).mockReturnValue(null);
});
const make = () =>
  createStore<LanghuanState>()(
    (set, get, api) =>
      ({
        documents: [backupDoc()],
        assets: [],
        trash: [],
        drafts: {},
        activeId: "d1",
        setStatus: vi.fn(),
        ...createSyncBackupSlice(set, get, api),
      }) as unknown as LanghuanState,
  );
it("does not seed examples or re-import old IDB notes into an explicitly restored empty library", async () => {
  vi.mocked(fetchBackupRestoreState).mockResolvedValue({
    generation: "restore",
    files: [],
  });
  vi.mocked(takeIdbLibrary).mockReturnValueOnce({
    documents: [backupDoc()],
    assets: [],
    trash: [],
  });
  const store = make();
  await store.getState().hydrateFromContent();
  expect(store.getState().documents).toEqual([]);
  expect(store.getState().activeId).toBeNull();
  expect(bulkWriteLibrary).not.toHaveBeenCalled();
});
it("still seeds a genuinely fresh unstamped library", async () => {
  const store = make();
  await store.getState().hydrateFromContent();
  expect(bulkWriteLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ seed: true }),
  );
  expect(store.getState().documents.length).toBeGreaterThan(0);
});
it("does not write seed data when the restore marker cannot be read", async () => {
  vi.mocked(fetchBackupRestoreState).mockRejectedValueOnce(
    new Error("state unreadable"),
  );
  const store = make();
  await store.getState().hydrateFromContent();
  expect(bulkWriteLibrary).not.toHaveBeenCalled();
  expect(store.getState().documents[0].id).toBe("d1");
});
