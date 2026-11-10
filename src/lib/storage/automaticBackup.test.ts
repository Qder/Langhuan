/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readAutoBackupSettings,
  writeAutoBackupSettings,
  startAutomaticBackup,
  runAutomaticBackup,
  AUTO_BACKUP_KEY,
} from "./automaticBackup";
import { saveAutomaticZip } from "./backupApi";
import { completeBackupFixture } from "./backupTestFixtures";
vi.mock("./backupService", () => ({
  collectBackup: vi.fn(async (payload) => ({ payload })),
}));
vi.mock("./backupApi", () => ({
  saveAutomaticZip: vi.fn(async () => [
    { path: "/private/.content-recovery/backups/auto.zip" },
  ]),
}));
vi.mock("../assets/store", () => ({
  getAssetBlob: vi.fn(async () => null),
  base64ToBlob: (s: string, mime: string) =>
    new Blob([Buffer.from(s, "base64")], { type: mime }),
  blobToBase64: async (b: Blob) =>
    Buffer.from(await b.arrayBuffer()).toString("base64"),
}));
let values: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000000);
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("open-app automatic backup", () => {
  it("defaults disabled and bounds device-local interval/rotation settings", () => {
    expect(readAutoBackupSettings()).toEqual({
      enabled: false,
      intervalMinutes: 60,
      keep: 5,
      lastAt: 0,
    });
    values.set(
      AUTO_BACKUP_KEY,
      JSON.stringify({
        enabled: true,
        intervalMinutes: 1,
        keep: 90,
        lastAt: -1,
      }),
    );
    expect(readAutoBackupSettings()).toEqual({
      enabled: true,
      intervalMinutes: 5,
      keep: 50,
      lastAt: 0,
    });
  });
  it("does not run disabled or before learning hydration", async () => {
    const run = vi.fn();
    const stop = startAutomaticBackup(
      completeBackupFixture,
      () => true,
      vi.fn(),
      Date.now,
      run,
    );
    await vi.advanceTimersByTimeAsync(3600000);
    expect(run).not.toHaveBeenCalled();
    stop();
    writeAutoBackupSettings({
      enabled: true,
      intervalMinutes: 5,
      keep: 2,
      lastAt: 0,
    });
    const unready = startAutomaticBackup(
      completeBackupFixture,
      () => false,
      vi.fn(),
      Date.now,
      run,
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).not.toHaveBeenCalled();
    unready();
  });
  it("runs when due, never overlaps, and stops with the app effect", async () => {
    writeAutoBackupSettings({
      enabled: true,
      intervalMinutes: 5,
      keep: 2,
      lastAt: Date.now(),
    });
    let release!: (s: string) => void;
    const run = vi.fn(
      () =>
        new Promise<string>((r) => {
          release = r;
        }),
    );
    const status = vi.fn();
    const stop = startAutomaticBackup(
      completeBackupFixture,
      () => true,
      status,
      Date.now,
      run,
    );
    await vi.advanceTimersByTimeAsync(240000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600000);
    expect(run).toHaveBeenCalledTimes(1);
    release("saved.zip");
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenCalledWith("自动备份已保存：saved.zip");
    stop();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("checks one overdue backup on open and reports retryable failure without advancing lastAt", async () => {
    writeAutoBackupSettings({
      enabled: true,
      intervalMinutes: 5,
      keep: 2,
      lastAt: 1,
    });
    const status = vi.fn();
    const run = vi.fn(async () => {
      throw new Error("disk full");
    });
    const stop = startAutomaticBackup(
      completeBackupFixture,
      () => true,
      status,
      Date.now,
      run,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(expect.stringContaining("可重试"));
    expect(readAutoBackupSettings().lastAt).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
  it("self-checks complete ZIP before storage/rotation and only records success after backend persist", async () => {
    vi.useRealTimers();
    writeAutoBackupSettings({
      enabled: true,
      intervalMinutes: 5,
      keep: 3,
      lastAt: 1,
    });
    await expect(
      runAutomaticBackup(completeBackupFixture()),
    ).resolves.toContain("backups");
    expect(saveAutomaticZip).toHaveBeenCalledWith(expect.any(String), 3);
    expect(readAutoBackupSettings().lastAt).toBeGreaterThan(1);
    expect(readAutoBackupSettings().lastAt).toBeLessThanOrEqual(Date.now());
    vi.mocked(saveAutomaticZip).mockRejectedValueOnce(
      new Error("write failed"),
    );
    const previous = readAutoBackupSettings().lastAt;
    await expect(runAutomaticBackup(completeBackupFixture())).rejects.toThrow(
      "write failed",
    );
    expect(readAutoBackupSettings().lastAt).toBe(previous);
  });
  it("does not rotate any backup when a primary binary is missing", async () => {
    vi.useRealTimers();
    const payload = completeBackupFixture();
    payload.assetBinaries = {};
    await expect(runAutomaticBackup(payload)).rejects.toThrow("缺失/损坏");
    expect(saveAutomaticZip).not.toHaveBeenCalled();
  });
});
