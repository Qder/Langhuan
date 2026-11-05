"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import {
  checkForDesktopUpdate,
  currentAppVersion,
  downloadAndInstallDesktopUpdate,
  explainUpdaterError,
  isTauriAndroid,
  isTauriDesktop,
  type Progress,
  type UpdateInfo,
} from "@/lib/desktop/updater";
import { isTauriRuntime } from "@/lib/storage/contentApi";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateSettings() {
  const [version, setVersion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [available, setAvailable] = React.useState<UpdateInfo | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);

  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    void currentAppVersion().then(setVersion);
  }, []);

  if (!isTauriRuntime()) return null;

  if (isTauriAndroid()) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
          更新
        </h3>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Android 调试包不自动更新。请到 GitHub Releases 下载新 APK，卸载本包或直接覆盖安装（侧载）。尚未接 Play
          商店。当前版本 {version || "…"}。
        </p>
      </section>
    );
  }

  if (!isTauriDesktop()) return null;

  async function onCheck() {
    setBusy(true);
    setMessage("");
    setAvailable(null);
    try {
      const found = await checkForDesktopUpdate();
      if (!found) {
        setMessage("已是最新版本。");
        return;
      }
      setAvailable(found);
      setMessage("");
    } catch (err) {
      setMessage(explainUpdaterError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onInstall() {
    setBusy(true);
    setMessage("正在下载并安装…");
    try {
      await downloadAndInstallDesktopUpdate(setProgress);
    } catch (err) {
      setMessage(explainUpdaterError(err));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
        更新
      </h3>
      <p className="text-sm text-[var(--muted)]">
        当前版本 {version || "…"}。检查 GitHub Releases 上的签名安装包；浏览器版请自行刷新页面。
      </p>
      <Button
        variant="outline"
        className="w-full justify-start"
        disabled={busy}
        onClick={() => void onCheck()}
        aria-label="检查更新"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "正在检查…" : "检查更新"}
      </Button>
      {available && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 space-y-2">
          <p className="text-sm font-medium">
            发现新版本 {available.version}
            <span className="ml-2 font-normal text-[var(--muted)]">
              （当前 {available.currentVersion}）
            </span>
          </p>
          <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{available.notes}</p>
          <Button variant="accent" className="w-full" disabled={busy} onClick={() => void onInstall()}>
            下载并安装
          </Button>
        </div>
      )}
      {progress && (
        <p className="text-xs text-[var(--muted)] tabular-nums">
          已下载 {formatBytes(progress.received)}
          {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
        </p>
      )}
      {message && (
        <p className="text-sm text-[var(--fg)]" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
