"use client";
import * as React from "react";
import { Download, Upload } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  buildLibraryZipDetailed,
  defaultBackupFilename,
  downloadBlob,
  formatBackupIntegritySummary,
  parseLibraryZipDetailed,
  backupHasBlockingIssues,
  base64ToBlob,
  type BackupParseResult,
  type BackupPayload,
} from "@/lib/storage/backup";
import { collectBackup } from "@/lib/storage/backupService";
import {
  payloadToBackupTree,
  payloadFromBackupTree,
  mergeBackupPayload,
  backupConflicts,
} from "@/lib/storage/backupTree";
import {
  stageLibraryBackup,
  applyLibraryBackup,
  listAutomaticZips,
  readAutomaticZip,
  fetchStagedBackup,
  fetchBackupSnapshot,
} from "@/lib/storage/backupApi";
import { ensureBackupAdoption } from "@/lib/storage/backupAdoption";
import {
  pauseLearningPersistence,
  canPrepareLibraryRestore,
} from "@/lib/storage/learningPersistence";
import { waitForLearningWrites } from "@/lib/storage/learningIO";
import { waitForContentWrites } from "@/lib/store/helpers/persistSchedule";
import {
  readAutoBackupSettings,
  writeAutoBackupSettings,
  runAutomaticBackup,
  type AutoBackupSettings,
} from "@/lib/storage/automaticBackup";
import type { RestoreStage, StoredBackup } from "@/lib/storage/backupProtocol";
import { flushScrollMemoryLibrary } from "@/lib/scrollMemory";
import { relativeTime } from "@/lib/utils";
type Preview = BackupParseResult & {
  current: BackupPayload | null;
  sourceError?: string;
  fingerprint: string;
  conflicts: string[];
};
export function BackupDialog() {
  const open = useStore((s) => s.backupDialogOpen);
  const setOpen = useStore((s) => s.setBackupDialogOpen);
  const exportPayload = useStore((s) => s.exportPayload);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const setLastBackupAt = useStore((s) => s.setLastBackupAt);
  const setStatus = useStore((s) => s.setStatus);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"merge" | "replace">("merge");
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [stage, setStage] = React.useState<RestoreStage | null>(null);
  const [ack, setAck] = React.useState(false);
  const [applied, setApplied] = React.useState<{
    generation: string;
    archive: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<AutoBackupSettings>(
    readAutoBackupSettings,
  );
  const [automatic, setAutomatic] = React.useState<StoredBackup[]>([]);
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    void listAutomaticZips()
      .then((items) => {
        setAutomatic(items);
        setSupported(true);
      })
      .catch(() => {
        setSupported(false);
      });
    const refresh = () => setSettings(readAutoBackupSettings());
    window.addEventListener("langhuan-backup-settings", refresh);
    return () =>
      window.removeEventListener("langhuan-backup-settings", refresh);
  }, [open]);
  const reset = () => {
    setFile(null);
    setPreview(null);
    setStage(null);
    setApplied(null);
    setAck(false);
    setError(null);
    setNote(null);
  };
  const work = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onExport = () =>
    work(async () => {
      if (!canPrepareLibraryRestore())
        throw new Error("知识库仍在载入，请稍后重试");
      await flushScrollMemoryLibrary();
      const { payload } = await collectBackup(exportPayload());
      const built = await buildLibraryZipDetailed(payload);
      downloadBlob(built.blob, defaultBackupFilename());
      setNote(formatBackupIntegritySummary(built.report));
      if (!backupHasBlockingIssues(built.report)) setLastBackupAt(Date.now());
      setStatus(
        built.report.ok
          ? "已导出完整学习库 ZIP"
          : "已导出备份，请检查完整性警告",
      );
    });
  const onPreview = (selected: File) =>
    work(async () => {
      reset();
      setFile(selected);
      const parsed = await parseLibraryZipDetailed(selected);
      if (!canPrepareLibraryRestore())
        throw new Error("知识库仍在载入，请稍后重试");
      const snapshot = await fetchBackupSnapshot();
      try {
        const { payload: current } = await collectBackup(
          exportPayload(),
          snapshot,
        );
        setPreview({
          ...parsed,
          current,
          fingerprint: snapshot.fingerprint,
          conflicts: backupConflicts(current, parsed.payload),
        });
      } catch (e) {
        setMode("replace");
        setPreview({
          ...parsed,
          current: null,
          sourceError: e instanceof Error ? e.message : String(e),
          fingerprint: snapshot.fingerprint,
          conflicts: [
            "当前主库无法完整读取，冲突范围未知；只允许保留原始字节后明确整库替换",
          ],
        });
      }
    });
  const onStage = () =>
    work(async () => {
      if (!preview || backupHasBlockingIssues(preview.report)) return;
      if (!canPrepareLibraryRestore())
        throw new Error("知识库仍在载入，请稍后重试");
      if (mode === "merge" && !preview.current)
        throw new Error("主库无法安全合并，只能明确替换并保留原库");
      if (useStore.getState().anyDirty())
        throw new Error("请先保存或处理当前笔记草稿，再创建隔离恢复副本");
      const payload =
        mode === "merge"
          ? mergeBackupPayload(preview.current!, preview.payload)
          : preview.payload;
      const restored = await stageLibraryBackup(
        payloadToBackupTree(payload),
        mode,
        preview.fingerprint,
      );
      setStage(restored);
      setAck(false);
    });
  const onApply = () =>
    work(async () => {
      if (!stage || !ack) return;
      if (!canPrepareLibraryRestore())
        throw new Error("知识库仍在载入，请稍后重试");
      await waitForContentWrites();
      await waitForLearningWrites();
      if (useStore.getState().anyDirty())
        throw new Error("当前还有未保存的草稿，未切换主库");
      const resume = pauseLearningPersistence();
      try {
        const result = applied ?? (await applyLibraryBackup(stage.id));
        setApplied(result);
        try {
          await ensureBackupAdoption(useStore.getState, useStore.setState);
        } catch (e) {
          throw new Error(
            `主库已采用且原库保留；本机接纳尚未完成，请重试：${e instanceof Error ? e.message : String(e)}`,
          );
        } finally {
          await useStore.getState().hydrateFromContent();
        }
        setNote(`恢复完成；原库完整保留于 ${result.archive}`);
        setStatus(`恢复完成；原库保留于 ${result.archive}`);
        setStage(null);
        setPreview(null);
        setFile(null);
        setApplied(null);
      } finally {
        resume();
      }
    });
  const changeSettings = (patch: Partial<AutoBackupSettings>) => {
    const next = { ...settings, ...patch };
    try {
      writeAutoBackupSettings(next);
      setSettings(next);
    } catch (e) {
      setError(
        `备份设置保存失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      labelledBy="backup-title"
      className="max-w-xl"
    >
      <div className="p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
        <h2 id="backup-title" className="font-serif text-lg font-semibold">
          备份与恢复
        </h2>
        <p className="text-sm text-[var(--muted)]">
          ZIP
          含正文、附件、回收站、批注、版本历史、练习、保存搜索、阅读进度和学习专题。不含讲解密钥/草稿、文件夹绑定、界面布局或读码工程专用数据；未保存的笔记草稿不在包中。
        </p>
        <p className="text-xs text-[var(--muted)]">
          上次备份：{lastBackupAt ? relativeTime(lastBackupAt) : "尚无"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="accent"
            disabled={busy}
            onClick={() => void onExport()}
          >
            <Download className="h-4 w-4" />
            导出全库 ZIP
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            选择备份并预览…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onPreview(f);
            }}
          />
        </div>
        {file && (
          <section className="rounded-xl border border-[var(--border)] p-3 space-y-3 text-sm">
            <div className="break-words font-medium">{file.name}</div>
            {preview && (
              <>
                <p>
                  {formatBackupIntegritySummary(preview.report)} · 回收站{" "}
                  {preview.payload.trash.length} · 版本{" "}
                  {Object.values(preview.payload.versions ?? {}).reduce(
                    (n, a) => n + a.length,
                    0,
                  )}{" "}
                  · 搜索 {preview.payload.savedSearches?.length ?? 0} · 进度{" "}
                  {Object.keys(preview.payload.readingProgress ?? {}).length}{" "}
                  · 专题 {preview.payload.topics?.length ?? 0}
                </p>
                {preview.sourceError && (
                  <p role="alert">
                    当前主库读取异常：{preview.sourceError}
                    。禁止合并；仍可先隔离恢复，确认后整库替换，原始字节完整归档。
                  </p>
                )}
                {preview.legacy && (
                  <p className="text-xs text-[var(--muted)]">
                    旧格式兼容导入：原包未提供的版本/搜索/进度/专题视为空；合并保留当前库，替换采用旧包内容。
                  </p>
                )}
                <ul className="max-h-40 overflow-auto space-y-1 text-xs">
                  {preview.report.issues.map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                  {preview.conflicts.map((p) => (
                    <li key={p}>正文/元数据冲突：{p}</li>
                  ))}
                </ul>
                {backupHasBlockingIssues(preview.report) && (
                  <p role="alert">
                    存在缺失或损坏，禁止采用到主库；请修复备份包后重试。
                  </p>
                )}
                <label className="flex gap-2">
                  <input
                    type="radio"
                    disabled={busy || !!applied || !preview.current}
                    checked={mode === "merge"}
                    onChange={() => {
                      setMode("merge");
                      setStage(null);
                      setAck(false);
                    }}
                  />
                  合并：同路径覆盖，其他笔记和资源保留
                </label>
                <label className="flex gap-2">
                  <input
                    type="radio"
                    disabled={busy || !!applied}
                    checked={mode === "replace"}
                    onChange={() => {
                      setMode("replace");
                      setStage(null);
                      setAck(false);
                    }}
                  />
                  整库替换：旧库（含包外工程/资源）移入保留目录
                </label>
                {!stage && (
                  <Button
                    variant="outline"
                    disabled={busy || backupHasBlockingIssues(preview.report)}
                    onClick={() => void onStage()}
                  >
                    先恢复到独立位置检查（不改主库）
                  </Button>
                )}
              </>
            )}
            {stage && (
              <>
                <p className="text-xs break-all">
                  {applied
                    ? `主库已采用；本机接纳待重试。原库：${applied.archive}`
                    : `隔离副本已写入并读回校验：${stage.path}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !!applied}
                  onClick={() =>
                    void work(async () => {
                      const actual = payloadFromBackupTree(
                        await fetchStagedBackup(stage.id),
                      );
                      downloadBlob(
                        (await buildLibraryZipDetailed(actual)).blob,
                        "langhuan-isolated-checked.zip",
                      );
                    })
                  }
                >
                  下载隔离副本检查
                </Button>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  我已检查隔离副本，确认采用所选模式、同路径覆盖和元数据按时间合并；原库保留但不会自动清理。
                </label>
                <Button
                  variant="accent"
                  disabled={busy || !ack}
                  onClick={() => void onApply()}
                >
                  {applied ? "重试本机数据接纳" : "确认采用到当前主库"}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !!applied}
              onClick={reset}
            >
              取消（主库不变，隔离目录保留）
            </Button>
          </section>
        )}
        <section className="rounded-xl border border-[var(--border)] p-3 text-sm space-y-2">
          <h3 className="font-medium">应用内自动备份</h3>
          <p className="text-xs text-[var(--muted)]">
            {supported
              ? "保存于主库旁的 .<主库目录名>-recovery/backups（实际路径见下）。"
              : "当前后端不可用，暂不能落盘自动备份。"}{" "}
            应用打开时每分钟检查；首次启用在所设间隔后备份。关闭/被杀掉不运行，后台定时可能延后；重开后只补一次到期检查。应用私有目录会随卸载/清数据消失，请定期下载到应用外。
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              disabled={!supported || busy}
              checked={settings.enabled}
              onChange={(e) =>
                changeSettings({
                  enabled: e.target.checked,
                  lastAt: Date.now(),
                })
              }
            />
            启用自动备份
          </label>
          <label className="flex items-center gap-2">
            间隔（分钟，5–10080）
            <input
              className="w-24 border rounded bg-transparent p-1"
              type="number"
              min={5}
              max={10080}
              value={settings.intervalMinutes}
              onChange={(e) =>
                changeSettings({
                  intervalMinutes: Math.max(
                    5,
                    Math.min(10080, Math.floor(Number(e.target.value) || 5)),
                  ),
                })
              }
            />
          </label>
          <label className="flex items-center gap-2">
            保留最近（1–50）
            <input
              className="w-24 border rounded bg-transparent p-1"
              type="number"
              min={1}
              max={50}
              value={settings.keep}
              onChange={(e) =>
                changeSettings({
                  keep: Math.max(
                    1,
                    Math.min(50, Math.floor(Number(e.target.value) || 1)),
                  ),
                })
              }
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !supported}
            onClick={() =>
              void work(async () => {
                const p = await runAutomaticBackup(exportPayload());
                setAutomatic(await listAutomaticZips());
                setLastBackupAt(Date.now());
                setNote(`自动备份已保存：${p}`);
              })
            }
          >
            立即保存到应用备份目录
          </Button>
          <ul className="space-y-1 text-xs">
            {automatic.map((a) => (
              <li key={a.name} className="break-all">
                <button
                  className="underline"
                  disabled={busy}
                  onClick={() =>
                    void work(async () =>
                      downloadBlob(
                        base64ToBlob(
                          await readAutomaticZip(a.name),
                          "application/zip",
                        ),
                        a.name,
                      ),
                    )
                  }
                >
                  {a.name}
                </button>{" "}
                · {a.bytes} 字节{" "}
                <span className="block text-[var(--muted)]">{a.path}</span>
              </li>
            ))}
          </ul>
        </section>
        {note && <p className="text-xs break-all">{note}</p>}
        {note?.startsWith("恢复完成") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            重新载入以刷新已打开的阅读页
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--accent)] break-words">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
