/** @vitest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { BackupDialog } from "./BackupDialog";
import {
  parseLibraryZipDetailed,
  buildLibraryZipDetailed,
  downloadBlob,
  verifyBackupPayload,
} from "@/lib/storage/backup";
import {
  stageLibraryBackup,
  applyLibraryBackup,
  fetchStagedBackup,
  fetchBackupSnapshot,
} from "@/lib/storage/backupApi";
import { ensureBackupAdoption } from "@/lib/storage/backupAdoption";
import { payloadToBackupTree } from "@/lib/storage/backupTree";
import { collectBackup } from "@/lib/storage/backupService";
import { completeBackupFixture } from "@/lib/storage/backupTestFixtures";
const { state } = vi.hoisted(() => ({
  state: {
    backupDialogOpen: true,
    setBackupDialogOpen: vi.fn(),
    exportPayload: vi.fn(),
    lastBackupAt: null,
    setLastBackupAt: vi.fn(),
    setStatus: vi.fn(),
    anyDirty: vi.fn(() => false),
    hydrateFromContent: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/store", () => ({
  useStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state, setState: vi.fn() },
  ),
}));
vi.mock("./ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@/lib/storage/backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/backup")>()),
  parseLibraryZipDetailed: vi.fn(),
  buildLibraryZipDetailed: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("@/lib/storage/backupApi", () => ({
  fetchBackupSnapshot: vi.fn(async () => ({
    files: [],
    fingerprint: "f",
    root: "temp",
  })),
  stageLibraryBackup: vi.fn(async () => ({
    id: "stage",
    path: "/isolated/library",
    baseFingerprint: "f",
    fingerprint: "s",
  })),
  applyLibraryBackup: vi.fn(async () => ({
    generation: "stage",
    archive: "/recovery/archives/old",
  })),
  fetchStagedBackup: vi.fn(async () => ({
    ...payloadToBackupTree(completeBackupFixture()),
    fingerprint: "s",
    root: "/isolated/library",
  })),
  listAutomaticZips: vi.fn(async () => []),
  readAutomaticZip: vi.fn(),
}));
vi.mock("@/lib/storage/backupService", () => ({
  collectBackup: vi.fn(async (payload) => ({
    payload,
    snapshot: { fingerprint: "f" },
  })),
}));
vi.mock("@/lib/storage/backupAdoption", () => ({
  ensureBackupAdoption: vi.fn(async () => {}),
}));
vi.mock("@/lib/storage/learningPersistence", () => ({
  pauseLearningPersistence: () => () => {},
  canPrepareLibraryRestore: () => true,
}));
vi.mock("@/lib/storage/learningIO", () => ({
  waitForLearningWrites: async () => {},
}));
vi.mock("@/lib/store/helpers/persistSchedule", () => ({
  waitForContentWrites: async () => {},
}));
vi.mock("@/lib/storage/automaticBackup", () => ({
  readAutoBackupSettings: () => ({
    enabled: false,
    intervalMinutes: 60,
    keep: 5,
    lastAt: 0,
  }),
  writeAutoBackupSettings: vi.fn(),
  runAutomaticBackup: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const button = (text: RegExp) =>
  [...host.querySelectorAll("button")].find((b) =>
    text.test(b.textContent ?? ""),
  )!;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.exportPayload.mockReturnValue(completeBackupFixture());
  vi.mocked(parseLibraryZipDetailed).mockResolvedValue({
    payload: completeBackupFixture(),
    report: verifyBackupPayload(completeBackupFixture()),
    legacy: false,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<BackupDialog />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function selectFile() {
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["zip"], "backup.zip")],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
it("preview precedes isolated stage, and only an explicit checked confirmation applies", async () => {
  await selectFile();
  expect(parseLibraryZipDetailed).toHaveBeenCalledTimes(1);
  expect(stageLibraryBackup).not.toHaveBeenCalled();
  expect(applyLibraryBackup).not.toHaveBeenCalled();
  await act(async () => button(/先恢复到独立位置/).click());
  expect(stageLibraryBackup).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("/isolated/library");
  expect(button(/确认采用到当前主库/).disabled).toBe(true);
  const ack = [...host.querySelectorAll('input[type="checkbox"]')].find((e) =>
    e.parentElement?.textContent?.includes("我已检查"),
  ) as HTMLInputElement;
  await act(async () => ack.click());
  await act(async () => button(/确认采用到当前主库/).click());
  expect(applyLibraryBackup).toHaveBeenCalledWith("stage");
  expect(ensureBackupAdoption).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("原库完整保留");
});
it("blocks corrupt preview before staging or any live apply", async () => {
  vi.mocked(parseLibraryZipDetailed).mockResolvedValueOnce({
    payload: completeBackupFixture(),
    report: {
      ...verifyBackupPayload(completeBackupFixture()),
      ok: false,
      issues: [{ kind: "corrupt-metadata", message: "进度文件损坏" }],
    },
    legacy: false,
  });
  await selectFile();
  expect(host.textContent).toContain("进度文件损坏");
  expect(button(/先恢复到独立位置/).disabled).toBe(true);
  expect(stageLibraryBackup).not.toHaveBeenCalled();
  expect(applyLibraryBackup).not.toHaveBeenCalled();
});

it("downloads the verified disk stage instead of re-exporting the live store", async () => {
  vi.mocked(buildLibraryZipDetailed).mockResolvedValueOnce({
    blob: new Blob(["checked stage"]),
    report: verifyBackupPayload(completeBackupFixture()),
    missingAssetBlobs: [],
  });
  await selectFile();
  await act(async () => button(/先恢复到独立位置/).click());
  await act(async () => button(/下载隔离副本检查/).click());
  expect(fetchStagedBackup).toHaveBeenCalledWith("stage");
  expect(downloadBlob).toHaveBeenCalledWith(
    expect.any(Blob),
    "langhuan-isolated-checked.zip",
  );
  expect(applyLibraryBackup).not.toHaveBeenCalled();
});

it("can explicitly replace a corrupt live library but cannot merge unknown data", async () => {
  vi.mocked(collectBackup).mockRejectedValueOnce(
    new Error("annotations.json 损坏"),
  );
  await selectFile();
  expect(host.textContent).toContain("当前主库读取异常");
  expect(
    (host.querySelector('input[type="radio"]') as HTMLInputElement).disabled,
  ).toBe(true);
  await act(async () => button(/先恢复到独立位置/).click());
  expect(stageLibraryBackup).toHaveBeenCalledWith(
    expect.anything(),
    "replace",
    "f",
  );
  expect(fetchBackupSnapshot).toHaveBeenCalled();
  expect(applyLibraryBackup).not.toHaveBeenCalled();
});
