"use client";

import * as React from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  buildLibraryZip,
  defaultBackupFilename,
  downloadBlob,
  parseLibraryZip,
} from "@/lib/storage/backup";
import { BACKUP_REMIND_DAYS } from "@/lib/storage/constants";
import { relativeTime, cn } from "@/lib/utils";

export function BackupDialog() {
  const open = useStore((s) => s.backupDialogOpen);
  const setOpen = useStore((s) => s.setBackupDialogOpen);
  const exportPayload = useStore((s) => s.exportPayload);
  const importLibrary = useStore((s) => s.importLibrary);
  const setLastBackupAt = useStore((s) => s.setLastBackupAt);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const setStatus = useStore((s) => s.setStatus);
  const documents = useStore((s) => s.documents);
  const trash = useStore((s) => s.trash);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"merge" | "replace">("merge");
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPendingFile(null);
      setError(null);
      setBusy(false);
      setMode("merge");
    }
  }, [open]);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await buildLibraryZip(exportPayload());
      downloadBlob(blob, defaultBackupFilename());
      const now = Date.now();
      setLastBackupAt(now);
      setStatus(`已导出全库备份（${documents.length} 篇）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmImport = async () => {
    if (!pendingFile) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await parseLibraryZip(pendingFile);
      importLibrary(payload, mode);
      setPendingFile(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const daysSince =
    lastBackupAt != null
      ? Math.floor((Date.now() - lastBackupAt) / (24 * 60 * 60 * 1000))
      : null;
  const needsRemind =
    lastBackupAt == null || (daysSince != null && daysSince >= BACKUP_REMIND_DAYS);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="backup-title" className="max-w-md">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="backup-title" className="font-serif text-lg font-semibold">
            备份与恢复
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            导出 zip 保留目录结构；导入时可选择合并或整库替换。数据现已存于 IndexedDB。
          </p>
        </div>

        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            needsRemind
              ? "border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted)]"
          )}
        >
          {lastBackupAt == null ? (
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              尚未导出过全库备份，建议尽快备份。
            </span>
          ) : (
            <span>
              上次备份：{relativeTime(lastBackupAt)}
              {needsRemind ? `（已超过 ${BACKUP_REMIND_DAYS} 天）` : ""}
            </span>
          )}
          <div className="mt-1 text-[var(--muted)]">
            当前库内 {documents.length} 篇 · 回收站 {trash.length} 篇
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="accent" disabled={busy} onClick={() => void onExport()}>
            <Download className="h-4 w-4" />
            导出全库 zip
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            选择备份包导入…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setPendingFile(f);
              setError(null);
              e.target.value = "";
            }}
          />
        </div>

        {pendingFile && (
          <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
            <div className="text-sm font-medium truncate">{pendingFile.name}</div>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">合并</span>
                  <span className="block text-xs text-[var(--muted)]">
                    同路径覆盖内容，新路径追加；不删现有文档。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-[var(--accent)]">整库替换</span>
                  <span className="block text-xs text-[var(--muted)]">
                    清空当前文档与草稿后导入（危险操作）。
                  </span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingFile(null)}>
                取消
              </Button>
              <Button
                variant="accent"
                size="sm"
                disabled={busy}
                onClick={() => void onConfirmImport()}
              >
                确认导入
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--accent)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
