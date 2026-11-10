"use client";
import { isTauriRuntime } from "./contentApi";
import type {
  BackupSnapshot,
  BackupTree,
  RestoreStage,
  StoredBackup,
  BackupFile,
} from "./backupProtocol";
async function request<T>(query: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("library_backup", { request: query });
  }
  const res = await fetch("/api/library/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error((await res.text()) || "备份 API 不可用");
  return (await res.json()) as T;
}
export const fetchBackupSnapshot = () =>
  request<BackupSnapshot>({ action: "snapshot" });
export const fetchBackupRestoreState = () =>
  request<{ generation: string; files: BackupFile[] } | null>({
    action: "state",
  });
export const stageLibraryBackup = (
  tree: BackupTree,
  mode: "merge" | "replace",
  expectedFingerprint: string,
) =>
  request<RestoreStage>({ action: "stage", tree, mode, expectedFingerprint });
export const applyLibraryBackup = (id: string) =>
  request<{ generation: string; archive: string }>({ action: "apply", id });
export const saveAutomaticZip = (base64: string, keep: number) =>
  request<StoredBackup[]>({ action: "save-auto", base64, keep });
export const listAutomaticZips = () =>
  request<StoredBackup[]>({ action: "list-auto" });
export const readAutomaticZip = (name: string) =>
  request<string>({ action: "read-auto", name });

export const fetchStagedBackup = (id: string) =>
  request<BackupSnapshot>({ action: "read-stage", id });
