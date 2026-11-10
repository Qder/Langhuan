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
import {
  checkForAndroidUpdate,
  downloadAndroidUpdate,
  explainAndroidUpdaterError,
  installAndroidUpdate,
  readAndroidAppVersion,
  type AndroidUpdateInfo,
} from "@/lib/android/updater";
import { ReleaseNotes } from "./ReleaseNotes";
import { cacheReleaseNotes, androidBuildId } from "@/lib/releaseNotes";
import { isTauriRuntime } from "@/lib/storage/contentApi";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AndroidUpdateSettings() {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [available, setAvailable] = React.useState<AndroidUpdateInfo | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [localPath, setLocalPath] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState("");

  React.useEffect(() => {
    void readAndroidAppVersion()
      .then((v) => setDetail(`${v.versionName} · versionCode ${v.versionCode}`))
      .catch(() => setDetail("无法读取实际 Android 版本"));
  }, []);

  async function onCheck() {
    setBusy(true);
    setMessage("");
    setAvailable(null);
    setLocalPath(null);
    setProgress(null);
    try {
      const found = await checkForAndroidUpdate();
      if (!found) {
        setMessage("已是最新版本。");
        return;
      }
      setAvailable(found);
      cacheReleaseNotes(androidBuildId(found.remote.versionName, found.remote.versionCode), found.remote.notes);
      setMessage("");
    } catch (err) {
      setMessage(explainAndroidUpdaterError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadAndInstall() {
    if (!available) return;
    setBusy(true);
    setMessage("正在下载…");
    setProgress(null);
    try {
      const path = await downloadAndroidUpdate(available.remote, setProgress);
      setLocalPath(path);
      setMessage("下载完成，正在打开系统安装界面…");
      await installAndroidUpdate(path);
      setMessage("已打开系统安装界面。请确认安装；装好后请返回打开琅嬛。本地库会保留。");
    } catch (err) {
      setMessage(explainAndroidUpdaterError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRetryInstall() {
    if (!localPath) return;
    setBusy(true);
    try {
      await installAndroidUpdate(localPath);
      setMessage("已打开系统安装界面。请确认安装；装好后请返回打开琅嬛。");
    } catch (err) {
      setMessage(explainAndroidUpdaterError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
        更新
      </h3>
      <p className="text-sm text-[var(--muted)] leading-relaxed">
        当前版本 {detail || "读取中…"}。检查 GitHub Releases 上的 APK；同一签名覆盖安装，库仍在应用私有目录。也可继续侧载
        <code className="mx-1 text-xs">adb install -r</code>。
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
            发现新版本 {available.remote.versionName}
            <span className="ml-2 font-normal text-[var(--muted)]">
              （code {available.remote.versionCode} · 当前 {available.current.versionCode}）
            </span>
          </p>
          <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">
            {available.remote.notes}
          </p>
          <Button
            variant="accent"
            className="w-full"
            disabled={busy}
            onClick={() => void onDownloadAndInstall()}
          >
            下载并安装
          </Button>
          {localPath && (
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => void onRetryInstall()}
            >
              再次打开安装界面
            </Button>
          )}
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

export function UpdateSettings() {
  return <><ReleaseNotes /><UpdateChannelSettings /></>;
}

function UpdateChannelSettings() {
  const [version, setVersion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [available, setAvailable] = React.useState<UpdateInfo | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);

  React.useEffect(() => {
    if (isTauriAndroid()) return;
    void currentAppVersion().then(setVersion).catch(() => setVersion("读取失败"));
  }, []);

  if (!isTauriRuntime()) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
          更新
        </h3>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          当前是浏览器。应用内「检查更新」只在桌面安装包和安卓 APK 里；这里刷新页面即可拿到最新前端。
        </p>
      </section>
    );
  }

  if (isTauriAndroid()) {
    return <AndroidUpdateSettings />;
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
      cacheReleaseNotes(`desktop:${found.version}`, found.notes);
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
