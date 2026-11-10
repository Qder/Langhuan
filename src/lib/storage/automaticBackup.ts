"use client";
import {
  buildLibraryZipDetailed,
  parseLibraryZipDetailed,
  backupHasBlockingIssues,
  blobToBase64,
  type BackupPayload,
} from "./backup";
import { collectBackup } from "./backupService";
import { flushScrollMemoryLibrary } from "../scrollMemory";
import { saveAutomaticZip } from "./backupApi";
export type AutoBackupSettings = {
  enabled: boolean;
  intervalMinutes: number;
  keep: number;
  lastAt: number;
};
export const AUTO_BACKUP_KEY = "lh.backupSettings";
export function readAutoBackupSettings(): AutoBackupSettings {
  const defaults = { enabled: false, intervalMinutes: 60, keep: 5, lastAt: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(AUTO_BACKUP_KEY) ?? "{}");
    return {
      enabled: raw.enabled === true,
      intervalMinutes: Math.max(
        5,
        Math.min(10080, Math.floor(Number(raw.intervalMinutes) || 60)),
      ),
      keep: Math.max(1, Math.min(50, Math.floor(Number(raw.keep) || 5))),
      lastAt: Number.isFinite(Number(raw.lastAt))
        ? Math.max(0, Number(raw.lastAt) || 0)
        : 0,
    };
  } catch {
    return defaults;
  }
}
export function writeAutoBackupSettings(settings: AutoBackupSettings): void {
  localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(settings));
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("langhuan-backup-settings"));
}
let running: Promise<string> | undefined;
export function runAutomaticBackup(fallback: BackupPayload): Promise<string> {
  if (running) return running;
  running = (async () => {
    const settings = readAutoBackupSettings();
    await flushScrollMemoryLibrary();
    const { payload } = await collectBackup(fallback);
    const built = await buildLibraryZipDetailed(payload);
    if (backupHasBlockingIssues(built.report))
      throw new Error("自动备份发现缺失/损坏数据，未轮换旧备份");
    const checked = await parseLibraryZipDetailed(built.blob);
    if (backupHasBlockingIssues(checked.report))
      throw new Error("自动备份自检失败，未轮换旧备份");
    const backups = await saveAutomaticZip(
      await blobToBase64(built.blob),
      settings.keep,
    );
    writeAutoBackupSettings({
      ...readAutoBackupSettings(),
      lastAt: Date.now(),
    });
    return backups[0]?.path ?? "";
  })().finally(() => {
    running = undefined;
  });
  return running;
}
/** Open-app interval only; no OS background job or resume/external-change detection. */
export function startAutomaticBackup(
  get: () => BackupPayload,
  ready: () => boolean,
  status: (s: string) => void,
  now = () => Date.now(),
  run = runAutomaticBackup,
): () => void {
  let stopped = false;
  let busy = false;
  const check = async () => {
    const s = readAutoBackupSettings();
    if (
      stopped ||
      busy ||
      !ready() ||
      !s.enabled ||
      now() - s.lastAt < s.intervalMinutes * 60000
    )
      return;
    busy = true;
    try {
      const path = await run(get());
      if (!stopped) status(`自动备份已保存：${path}`);
    } catch (e) {
      if (!stopped)
        status(
          `自动备份未确认完成，可重试（已落盘副本以列表为准）：${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void check();
  }, 60000);
  void check();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
