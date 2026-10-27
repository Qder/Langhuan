"use client";

import * as React from "react";
import { FolderSync, FolderOpen, Unplug, RefreshCw, AlertTriangle } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  clearStoredHandle,
  ensurePermission,
  getStoredHandle,
  isFsAccessSupported,
  pickDirectory,
  storeHandle,
  syncBidirectional,
  syncOutAll,
} from "@/lib/storage/fsSync";
import { relativeTime, cn } from "@/lib/utils";

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
  const [permOk, setPermOk] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
      setInfo(null);
      return;
    }
    setSupported(isFsAccessSupported());
    void (async () => {
      const h = await getStoredHandle();
      if (!h) {
        setPermOk(null);
        if (fsBoundName) {
          // Stale name without handle (other browser / cleared IDB handle)
          setInfo("本地句柄丢失，请重新绑定文件夹。");
        }
        return;
      }
      const ok = await ensurePermission(h, "readwrite");
      setPermOk(ok);
      if (!ok) setInfo("需要重新授权读写权限，点击「立即同步」或重新绑定。");
      if (h.name && h.name !== fsBoundName) setFsBoundName(h.name);
    })();
  }, [open, fsBoundName, setFsBoundName]);

  const onBind = async (writeAll: boolean) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
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
        setInfo("已绑定。保存文档时会写入磁盘；也可点「立即同步」。");
      }
      setPermOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "绑定失败");
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
        parts.push(`冲突(磁盘优先) ${result.inn.conflicts.length}`);
      }
      const msg = `同步完成：${parts.join(" · ")}`;
      setStatus(msg);
      setInfo(msg);
      const errs = [...result.out.errors, ...result.inn.errors];
      if (errs.length) setError(errs.slice(0, 3).join("；"));
      if (result.inn.conflicts.length) {
        setInfo(
          (msg +
            "。冲突文件（两侧均有改动，已采用磁盘）：" +
            result.inn.conflicts.slice(0, 5).join("、") +
            (result.inn.conflicts.length > 5 ? "…" : "")) as string
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
      await clearStoredHandle();
      setFsBoundName(null);
      setFsLastSyncAt(null);
      setPermOk(null);
      setStatus("已解除本地文件夹绑定（库内数据仍在 IndexedDB）");
      setInfo("已解除绑定。IndexedDB 中的笔记不受影响。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="fs-sync-title" className="max-w-md">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="fs-sync-title" className="font-serif text-lg font-semibold">
            本地文件夹同步
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            用 File System Access 绑定磁盘目录：保存时写出真实 .md / .html，可用 Git、网盘、Obsidian
            打开。IndexedDB 仍是会话内权威数据源，磁盘为镜像。
          </p>
        </div>

        {!supported && (
          <div className="rounded-xl border border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--accent)] flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              当前浏览器不支持此 API（常见于 Safari / Firefox）。请使用最新版 Chrome 或 Edge。仍可继续用 zip
              备份。
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
              <Button variant="accent" disabled={busy || !supported} onClick={() => void onSync()}>
                <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
                立即同步
              </Button>
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
            ；正文内标签仍用 Markdown YAML / HTML keywords。冲突时磁盘优先。
          </p>
          <p>MVP 不会因库内删除而删磁盘文件；权限被系统收回后需重新授权。</p>
        </div>
      </div>
    </Dialog>
  );
}
