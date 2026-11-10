"use client";

import * as React from "react";
import {
  FolderSync,
  FolderOpen,
  Unplug,
  RefreshCw,
  AlertTriangle,
  ScanSearch,
  Check,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  applyDiskOverwrite,
  applyExternalPull,
  buildIndexAfterExternalPull,
  clearStoredHandle,
  collectExternalSnapshot,
  formatAssetSkipSummary,
  detectExternalChanges,
  ensurePermission,
  getStoredHandle,
  isFsAccessSupported,
  patchIndexAfterDiskOverwrite,
  pickDirectory,
  storeHandle,
  syncBidirectional,
  syncOutAll,
  writeIndex,
  type DiskAsset,
  type DiskDoc,
  type ExternalChange,
  type FsIndex,
} from "@/lib/storage/fsSync";
import { putAssetBlob, deleteAssetBlob } from "@/lib/assets/store";
import { blobToBase64, putLibraryAsset, deleteLibraryAsset } from "@/lib/storage/contentApi";
import { relativeTime, cn } from "@/lib/utils";
import {
  getSafBound,
  isAndroidSafAvailable,
  pickSafTree,
  unbindSaf,
} from "@/lib/android/saf";
import {
  getMirrorBackend,
  pullLibraryFromMirror,
  pushLibraryToMirror,
} from "@/lib/storage/folderMirror";

const CHANGE_LABEL: Record<ExternalChange["change"], string> = {
  add: "新增",
  modify: "修改",
  delete: "删除",
  conflict: "冲突",
};

export function FsSyncDialog() {
  const open = useStore((s) => s.fsSyncDialogOpen);
  const setOpen = useStore((s) => s.setFsSyncDialogOpen);
  const fsBoundName = useStore((s) => s.fsBoundName);
  const setFsBoundName = useStore((s) => s.setFsBoundName);
  const fsLastSyncAt = useStore((s) => s.fsLastSyncAt);
  const setFsLastSyncAt = useStore((s) => s.setFsLastSyncAt);
  const documents = useStore((s) => s.documents);
  const applySyncedDocuments = useStore((s) => s.applySyncedDocuments);
  const setStatus = useStore((s) => s.setStatus);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [supported, setSupported] = React.useState(true);
  const [fsaOk, setFsaOk] = React.useState(false);
  const [permOk, setPermOk] = React.useState<boolean | null>(null);
  const [changes, setChanges] = React.useState<ExternalChange[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const snapRef = React.useRef<{
    docs: DiskDoc[];
    assets: DiskAsset[];
    index: FsIndex;
  } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
      setInfo(null);
      setChanges([]);
      setSelected({});
      setExpanded({});
      snapRef.current = null;
      return;
    }
    const backend = getMirrorBackend();
    setSupported(backend != null);
    setFsaOk(isFsAccessSupported());
    void (async () => {
      if (isAndroidSafAvailable()) {
        try {
          const b = await getSafBound();
          if (b.bound) {
            setPermOk(b.writable);
            if (b.name && b.name !== fsBoundName) setFsBoundName(b.name);
            if (!b.writable) {
              setInfo("需要重新授权读写权限，请重新绑定文件夹。");
            }
            return;
          }
        } catch {
          /* fall through to FSA handle */
        }
      }
      const h = await getStoredHandle();
      if (!h) {
        setPermOk(null);
        if (fsBoundName) {
          setInfo("本地句柄丢失，请重新绑定文件夹。");
        }
        return;
      }
      const ok = await ensurePermission(h, "readwrite");
      setPermOk(ok);
      if (!ok) setInfo("需要重新授权读写权限，点击下方同步或重新绑定。");
      if (h.name && h.name !== fsBoundName) setFsBoundName(h.name);
    })();
  }, [open, fsBoundName, setFsBoundName]);

  const onBind = async (writeAll: boolean) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const backend = getMirrorBackend();
      if (!backend) {
        setError("当前环境不能绑定文件夹。平板请用琅嬛 APK；电脑请用 Chrome / Edge。");
        return;
      }
      if (backend === "saf") {
        const bound = await pickSafTree();
        if (!bound) return;
        setFsBoundName(bound.name);
        setPermOk(bound.writable);
        if (writeAll) {
          const st = useStore.getState();
          const out = await pushLibraryToMirror(st.documents, st.assets);
          const now = Date.now();
          setFsLastSyncAt(now);
          setStatus(`已绑定「${bound.name}」并写出 ${out.written} 项`);
          setInfo(
            out.errors.length
              ? `写出 ${out.written} 项，${out.errors.length} 个错误`
              : `已写出整库 ${out.written} 项到「${bound.name}」`
          );
          if (out.errors.length) setError(out.errors.slice(0, 3).join("；"));
        } else {
          setStatus(`已绑定本地文件夹「${bound.name}」`);
          setInfo("已绑定。请点「应用 → 本地」或「本地 → 应用」；不会自动互相同步。");
        }
        return;
      }
      if (!isFsAccessSupported()) {
        setError("当前浏览器不支持 File System Access API（请用 Chrome / Edge）。");
        return;
      }
      const handle = await pickDirectory();
      if (!handle) return;
      const ok = await ensurePermission(handle, "readwrite");
      if (!ok) {
        setError("未获得文件夹读写权限");
        return;
      }
      await storeHandle(handle);
      setFsBoundName(handle.name);
      if (writeAll) {
        const st = useStore.getState();
        const out = await syncOutAll(handle, st.documents, st.assets);
        const now = Date.now();
        setFsLastSyncAt(now);
        setStatus(`已绑定「${handle.name}」并写出 ${out.written} 篇`);
        setInfo(
          out.errors.length
            ? `写出 ${out.written} 篇，${out.errors.length} 个错误`
            : `已写出整库 ${out.written} 篇到「${handle.name}」`
        );
        if (out.errors.length) setError(out.errors.slice(0, 3).join("；"));
      } else {
        setStatus(`已绑定本地文件夹「${handle.name}」`);
        setInfo("已绑定。保存文档时会写入磁盘；也可点方向同步，或「检测外部更改」。");
      }
      setPermOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  const onPushToLocal = async () => {
    const ok = window.confirm(
      "从应用同步到本地：用当前库覆盖文件夹里的同路径文件。文件夹里多出来的文件不会删。确定？"
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const st = useStore.getState();
      const out = await pushLibraryToMirror(st.documents, st.assets);
      const now = Date.now();
      setFsLastSyncAt(now);
      const msg = `已从应用同步到本地：写出 ${out.written} 项`;
      setStatus(msg);
      setInfo(msg);
      if (out.errors.length) setError(out.errors.slice(0, 3).join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const onPullFromLocal = async () => {
    const ok = window.confirm(
      "从本地同步到应用：用文件夹覆盖库里的同路径笔记。库里多出来的篇目不会删。确定？"
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const st = useStore.getState();
      const pulled = await pullLibraryFromMirror(st.documents, st.assets);
      applySyncedDocuments(pulled.documents, pulled.assets);
      const now = Date.now();
      setFsLastSyncAt(now);
      const parts = [
        `新 ${pulled.inn.imported}`,
        `覆盖 ${pulled.inn.updated}`,
        `未变 ${pulled.inn.unchanged}`,
      ];
      if (pulled.truncated) parts.push("扫描已截断");
      const msg = `已从本地同步到应用：${parts.join(" · ")}`;
      setStatus(msg);
      setInfo(pulled.assetSkipSummary ? `${msg}。${pulled.assetSkipSummary}` : msg);
      if (pulled.inn.errors.length) setError(pulled.inn.errors.slice(0, 3).join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const onDetect = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let handle = await getStoredHandle();
      if (!handle) {
        handle = await pickDirectory();
        if (!handle) return;
        await storeHandle(handle);
        setFsBoundName(handle.name);
      }
      const ok = await ensurePermission(handle, "readwrite");
      setPermOk(ok);
      if (!ok) {
        setError("未获得文件夹读写权限，请重新授权或重新绑定");
        return;
      }
      const snap = await collectExternalSnapshot(handle, useStore.getState().documents);
      snapRef.current = snap;
      const st = useStore.getState();
      const list = detectExternalChanges(
        st.documents,
        st.assets,
        snap.docs,
        snap.assets.map(({ path, mtime, size }) => ({ path, mtime, size })),
        snap.index
      );
      setChanges(list);
      const sel: Record<string, boolean> = {};
      for (const c of list) {
        // Conflicts stay unchecked (skip). Deletes require explicit check.
        sel[`${c.entity}:${c.path}`] =
          c.change !== "conflict" && c.change !== "delete";
      }
      setSelected(sel);
      setExpanded({});
      const skipText = formatAssetSkipSummary(
        snap.skippedAssets,
        snap.truncatedAssets
      );
      if (!list.length) {
        setInfo(
          skipText
            ? `未发现外部更改（按 mtime/size 对比）。${skipText}`
            : "未发现外部更改（按 mtime/size 对比）。"
        );
      } else {
        setInfo(
          `发现 ${list.length} 项外部更改。冲突默认保留 content/，请勾选后确认拉入。` +
            (skipText ? ` ${skipText}` : "")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "检测失败");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmPull = async () => {
    const snap = snapRef.current;
    if (!snap) {
      setError("请先检测外部更改");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const handle = await getStoredHandle();
      if (!handle) {
        setError("未绑定文件夹");
        return;
      }
      const st = useStore.getState();
      const picked = changes.filter((c) => selected[`${c.entity}:${c.path}`]);
      const pulled = applyExternalPull(
        st.documents,
        st.assets,
        snap.docs,
        snap.assets,
        snap.index,
        picked
      );

      // Persist new/updated asset binaries into IDB + content/
      const prevAssets = st.assets;
      const failedAssetPaths: string[] = [];
      for (const ch of pulled.applied) {
        if (ch.entity !== "asset") continue;
        if (ch.change === "delete") {
          const victim = prevAssets.find((a) => a.path === ch.path);
          if (!victim) continue;
          try {
            await deleteAssetBlob(victim.id);
            await deleteLibraryAsset(victim.path);
          } catch (e) {
            failedAssetPaths.push(ch.path);
            pulled.errors.push(
              `${ch.path}: ${e instanceof Error ? e.message : String(e)}`
            );
          }
          continue;
        }
        const disk = snap.assets.find((a) => a.path === ch.path);
        const meta = pulled.assets.find((a) => a.path === ch.path);
        if (!disk || !meta) {
          failedAssetPaths.push(ch.path);
          continue;
        }
        try {
          await putAssetBlob(meta.id, disk.blob);
          const b64 = await blobToBase64(disk.blob);
          await putLibraryAsset({
            path: meta.path,
            base64: b64,
            mime: meta.mime,
            id: meta.id,
            docId: meta.docId,
            createdAt: meta.createdAt,
          });
        } catch (e) {
          failedAssetPaths.push(ch.path);
          pulled.errors.push(
            `${ch.path}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      applySyncedDocuments(pulled.documents, pulled.assets);
      const now = Date.now();
      try {
        await writeIndex(
          handle,
          buildIndexAfterExternalPull(
            snap.index,
            pulled.documents,
            pulled.applied,
            failedAssetPaths,
            now
          )
        );
      } catch {
        /* index best-effort */
      }
      setFsLastSyncAt(now);
      const parts = [
        `已拉入 ${pulled.applied.length}`,
        pulled.skippedConflicts.length
          ? `保留 content/ 冲突 ${pulled.skippedConflicts.length}`
          : null,
        pulled.errors.length ? `错误 ${pulled.errors.length}` : null,
      ].filter(Boolean);
      const msg = `外部更改已处理：${parts.join(" · ")}`;
      setStatus(msg);
      setInfo(
        msg +
          (pulled.skippedConflicts.length
            ? `。冲突未覆盖：${pulled.skippedConflicts.slice(0, 5).join("、")}`
            : "")
      );
      if (pulled.errors.length) setError(pulled.errors.slice(0, 3).join("；"));
      setChanges([]);
      setSelected({});
      setExpanded({});
      snapRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉入失败");
    } finally {
      setBusy(false);
    }
  };

  const onOverwriteFromDisk = async (change: ExternalChange) => {
    if (change.change !== "conflict" || change.entity !== "doc") return;
    const snap = snapRef.current;
    if (!snap) {
      setError("请先检测外部更改");
      return;
    }
    const ok = window.confirm(
      `确定用磁盘版本覆盖 content/ 中的「${change.path}」？\n此操作不可自动撤销。`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await getStoredHandle();
      if (!handle) {
        setError("未绑定文件夹");
        return;
      }
      const st = useStore.getState();
      const now = Date.now();
      const over = applyDiskOverwrite(st.documents, snap.docs, [change.path], now);
      if (over.errors.length) {
        setError(over.errors.slice(0, 3).join("；"));
        return;
      }
      if (!over.overwritten.length) {
        setError(`未能覆盖 ${change.path}`);
        return;
      }
      applySyncedDocuments(over.documents);
      try {
        await writeIndex(
          handle,
          patchIndexAfterDiskOverwrite(snap.index, over.documents, over.overwritten, now)
        );
        snapRef.current = {
          ...snap,
          index: patchIndexAfterDiskOverwrite(snap.index, over.documents, over.overwritten, now),
        };
      } catch {
        /* index best-effort */
      }
      setFsLastSyncAt(now);
      const msg = `已用磁盘覆盖 ${change.path}`;
      setStatus(msg);
      setInfo(msg);
      const key = `${change.entity}:${change.path}`;
      setChanges((list) => list.filter((c) => `${c.entity}:${c.path}` !== key));
      setSelected((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      setExpanded((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "覆盖失败");
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let handle = await getStoredHandle();
      if (!handle) {
        handle = await pickDirectory();
        if (!handle) return;
        await storeHandle(handle);
        setFsBoundName(handle.name);
      }
      const ok = await ensurePermission(handle, "readwrite");
      setPermOk(ok);
      if (!ok) {
        setError("未获得文件夹读写权限，请重新授权或重新绑定");
        return;
      }
      const st = useStore.getState();
      const { documents: next, result } = await syncBidirectional(
        handle,
        st.documents,
        st.assets
      );
      applySyncedDocuments(next);
      const now = Date.now();
      setFsLastSyncAt(now);
      const parts = [
        `写出 ${result.out.written}`,
        `读入新 ${result.inn.imported}`,
        `更新 ${result.inn.updated}`,
      ];
      if (result.inn.conflicts.length) {
        parts.push(`冲突(保留 content/) ${result.inn.conflicts.length}`);
      }
      const msg = `同步完成：${parts.join(" · ")}`;
      setStatus(msg);
      setInfo(msg);
      const errs = [...result.out.errors, ...result.inn.errors];
      if (errs.length) setError(errs.slice(0, 3).join("；"));
      if (result.inn.conflicts.length) {
        setInfo(
          msg +
            "。冲突文件（两侧均有改动，已保留 content/）：" +
            result.inn.conflicts.slice(0, 5).join("、") +
            (result.inn.conflicts.length > 5 ? "…" : "")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const onUnbind = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isAndroidSafAvailable()) {
        try {
          await unbindSaf();
        } catch {
          /* still clear local state */
        }
      }
      await clearStoredHandle();
      setFsBoundName(null);
      setFsLastSyncAt(null);
      setPermOk(null);
      setStatus("已解除本地文件夹绑定（content/ 库内数据仍在）");
      setInfo("已解除绑定。content/ 中的笔记不受影响。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      labelledBy="fs-sync-title"
      className="max-w-2xl"
    >
      <div className="p-5 space-y-4">
        <div>
          <h2 id="fs-sync-title" className="font-serif text-lg font-semibold">
            本地文件夹同步（可选镜像）
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            知识库主数据在 <code className="text-xs">content/</code>
            。绑定文件夹后，由你选择方向：应用 → 本地，或本地 → 应用。同路径覆盖来源；另一侧多出来的文件不会删。不做持续
            watch。
          </p>
        </div>

        {!supported && (
          <div className="rounded-xl border border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--accent)] flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              当前环境不能绑定文件夹。平板请安装琅嬛 APK 后在本对话框选目录；电脑请用
              Chrome / Edge。仍可继续用 zip 备份。
            </span>
          </div>
        )}

        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            fsBoundName
              ? "border-[var(--border)] text-[var(--fg)]"
              : "border-[var(--border)] text-[var(--muted)]"
          )}
        >
          {fsBoundName ? (
            <>
              <div className="font-medium truncate">已绑定：{fsBoundName}</div>
              <div className="mt-1 text-[var(--muted)]">
                上次同步：
                {fsLastSyncAt != null ? relativeTime(fsLastSyncAt) : "尚未同步"}
                {permOk === false ? " · 权限待授权" : ""}
              </div>
            </>
          ) : (
            <span>尚未绑定本地文件夹</span>
          )}
          <div className="mt-1 text-[var(--muted)]">当前库内 {documents.length} 篇</div>
        </div>

        <div className="flex flex-col gap-2">
          {!fsBoundName ? (
            <>
              <Button
                variant="accent"
                disabled={busy || !supported}
                onClick={() => void onBind(true)}
              >
                <FolderOpen className="h-4 w-4" />
                绑定并写出整库…
              </Button>
              <Button
                variant="outline"
                disabled={busy || !supported}
                onClick={() => void onBind(false)}
              >
                <FolderSync className="h-4 w-4" />
                仅绑定文件夹…
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="accent"
                disabled={busy || !supported}
                onClick={() => void onPushToLocal()}
              >
                <ArrowUpFromLine className={cn("h-4 w-4", busy && "animate-pulse")} />
                应用 → 本地
              </Button>
              <Button
                variant="accent"
                disabled={busy || !supported}
                onClick={() => void onPullFromLocal()}
              >
                <ArrowDownToLine className={cn("h-4 w-4", busy && "animate-pulse")} />
                本地 → 应用
              </Button>
              {fsaOk && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy || !supported}
                    onClick={() => void onDetect()}
                  >
                    <ScanSearch className={cn("h-4 w-4", busy && "animate-pulse")} />
                    检测外部更改
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !supported}
                    onClick={() => void onSync()}
                  >
                    <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
                    智能双向（冲突保留应用）
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                disabled={busy || !supported}
                onClick={() => void onBind(true)}
              >
                <FolderOpen className="h-4 w-4" />
                换绑并写出整库…
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void onUnbind()}>
                <Unplug className="h-4 w-4" />
                解除绑定
              </Button>
            </>
          )}
        </div>

        {changes.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] max-h-80 overflow-auto">
            <ul className="divide-y divide-[var(--border)] text-xs">
              {changes.map((c) => {
                const key = `${c.entity}:${c.path}`;
                const isOpen = !!expanded[key];
                return (
                  <li key={key} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={!!selected[key]}
                        disabled={c.change === "conflict"}
                        title={
                          c.change === "conflict"
                            ? "冲突默认跳过，保留 content/"
                            : c.change === "delete"
                              ? "删除类默认不勾选"
                              : undefined
                        }
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [key]: e.target.checked }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={cn(
                              "rounded px-1 py-0.5 text-[10px]",
                              c.change === "conflict"
                                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                                : c.change === "delete"
                                  ? "bg-[var(--hover)] text-[var(--accent)]"
                                  : "bg-[var(--hover)] text-[var(--muted)]"
                            )}
                          >
                            {CHANGE_LABEL[c.change]}
                            {c.entity === "asset" ? "·图" : ""}
                          </span>
                          <span className="font-mono truncate">{c.path}</span>
                          {c.change === "conflict" && (
                            <span className="ml-auto flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                className="text-[10px] text-[var(--accent)] hover:underline"
                                onClick={() =>
                                  setExpanded((s) => ({ ...s, [key]: !s[key] }))
                                }
                              >
                                {isOpen ? "收起对照" : "展开对照"}
                              </button>
                              {c.entity === "doc" && (
                                <button
                                  type="button"
                                  className="text-[10px] rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-40"
                                  disabled={busy}
                                  onClick={() => void onOverwriteFromDisk(c)}
                                >
                                  用磁盘覆盖 content/
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                        {c.detail && (
                          <div className="mt-0.5 text-[var(--muted)]">{c.detail}</div>
                        )}
                        {c.change === "conflict" && isOpen && (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                                content/（将保留）
                              </div>
                              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed max-h-36 overflow-auto">
                                {c.libraryExcerpt || "（空）"}
                              </pre>
                            </div>
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                                磁盘
                              </div>
                              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed max-h-36 overflow-auto">
                                {c.diskExcerpt || "（空）"}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-[var(--border)] p-2">
              <Button
                variant="accent"
                className="w-full"
                disabled={busy || !Object.values(selected).some(Boolean)}
                onClick={() => void onConfirmPull()}
              >
                <Check className="h-4 w-4" />
                确认拉入 content/
              </Button>
            </div>
          </div>
        )}

        {info && (
          <p className="text-xs text-[var(--muted)] leading-relaxed whitespace-pre-wrap">{info}</p>
        )}
        {error && (
          <p className="text-xs text-[var(--accent)] leading-relaxed" role="alert">
            {error}
          </p>
        )}

        <div className="text-[11px] text-[var(--muted)] leading-relaxed border-t border-[var(--border)] pt-3 space-y-1">
          <p>
            元数据写入 <code className="font-mono">.langhuan/index.json</code>
            ；正文内标签仍用 Markdown YAML / HTML keywords。方向同步按你点的一侧覆盖同路径；电脑上「智能双向」在两侧都改时仍保留{" "}
            <code className="font-mono">content/</code>。
          </p>
          <p>不做持续后台监听；库内删除不会自动删磁盘文件。安卓绑定走系统文件夹选择，权限在卸载前会记住。</p>
        </div>
      </div>
    </Dialog>
  );
}
