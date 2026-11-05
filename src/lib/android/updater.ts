/**
 * Android in-app update (sidecar APK).
 * Manifest is separate from desktop Tauri latest.json — see android-latest.json.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauriAndroid } from "@/lib/desktop/updater";

/** Default production manifest on GitHub Releases (asset name must be exact). */
export const ANDROID_LATEST_JSON_URL =
  "https://github.com/Qder/Langhuan/releases/latest/download/android-latest.json";

export type AndroidLatestManifest = {
  versionCode: number;
  versionName: string;
  notes: string;
  pubDate?: string;
  apkUrl: string;
  sha256: string;
};

export type AndroidVersionInfo = {
  versionCode: number;
  versionName: string;
};

export type AndroidUpdateInfo = {
  current: AndroidVersionInfo;
  remote: AndroidLatestManifest;
};

export type Progress = { received: number; total: number | null };

export function parseAndroidLatestManifest(raw: unknown): AndroidLatestManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("更新清单格式不对");
  }
  const o = raw as Record<string, unknown>;
  const versionCode = Number(o.versionCode);
  if (!Number.isFinite(versionCode) || versionCode < 1) {
    throw new Error("更新清单缺少有效的 versionCode");
  }
  const versionName = String(o.versionName ?? "").trim();
  if (!versionName) throw new Error("更新清单缺少 versionName");
  const apkUrl = String(o.apkUrl ?? "").trim();
  if (!apkUrl) throw new Error("更新清单缺少 apkUrl");
  const sha256 = String(o.sha256 ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("更新清单 sha256 无效");
  }
  return {
    versionCode: Math.floor(versionCode),
    versionName,
    notes: String(o.notes ?? "").trim() || "（此版本没有更新说明）",
    pubDate: o.pubDate ? String(o.pubDate) : undefined,
    apkUrl,
    sha256,
  };
}

export function isNewerAndroidBuild(
  remoteCode: number,
  localCode: number
): boolean {
  return remoteCode > localCode;
}

export function explainAndroidUpdaterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.toLowerCase();
  if (!raw.trim()) return "检查更新失败，请稍后重试。";
  if (/unknown_sources|安装未知/.test(raw)) {
    return raw.replace(/^UNKNOWN_SOURCES:/, "").trim();
  }
  if (/sha256|校验失败|不匹配/.test(raw)) {
    return "更新包校验失败（sha256 不匹配），没有安装。请从 GitHub Releases 核对来源后再试。";
  }
  if (
    /failed to fetch|network|dns|timed out|timeout|econnrefused|connect|unavailable|502|503|504|连不上/.test(
      msg
    )
  ) {
    return "连不上更新服务器。检查网络后重试。";
  }
  if (/404|not found|找不到更新/.test(msg)) {
    return "找不到更新清单。可能还没有发布过安装包。";
  }
  if (/https|insecure|更新通道必须/.test(msg)) {
    return "更新通道必须使用 HTTPS。当前清单地址不可用。";
  }
  return `检查更新失败：${raw.slice(0, 160)}`;
}

export async function fetchAndroidLatestManifest(
  url: string = ANDROID_LATEST_JSON_URL
): Promise<AndroidLatestManifest> {
  // Prefer Rust reqwest so GitHub Releases is not blocked by WebView CORS.
  if (isTauriAndroid()) {
    const remote = await invoke<{
      versionCode: number;
      versionName: string;
      notes: string;
      pubDate?: string | null;
      apkUrl: string;
      sha256: string;
    }>("android_fetch_latest_manifest", { url });
    return parseAndroidLatestManifest(remote);
  }
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    throw new Error("找不到更新清单。可能还没有发布过安装包。");
  }
  if (!res.ok) {
    throw new Error(`连不上更新服务器：HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseAndroidLatestManifest(json);
}

export async function readAndroidAppVersion(): Promise<AndroidVersionInfo> {
  if (!isTauriAndroid()) {
    throw new Error("仅 Android 支持应用内更新");
  }
  return invoke<AndroidVersionInfo>("android_app_version");
}

/** null = already latest */
export async function checkForAndroidUpdate(
  manifestUrl: string = ANDROID_LATEST_JSON_URL
): Promise<AndroidUpdateInfo | null> {
  const [current, remote] = await Promise.all([
    readAndroidAppVersion(),
    fetchAndroidLatestManifest(manifestUrl),
  ]);
  if (!isNewerAndroidBuild(remote.versionCode, current.versionCode)) {
    return null;
  }
  return { current, remote };
}

export async function downloadAndroidUpdate(
  remote: AndroidLatestManifest,
  onProgress?: (p: Progress) => void
): Promise<string> {
  if (!isTauriAndroid()) {
    throw new Error("仅 Android 支持应用内更新");
  }
  const on_progress = new Channel<Progress>();
  on_progress.onmessage = (p) => {
    onProgress?.({
      received: p.received,
      total: p.total ?? null,
    });
  };
  return invoke<string>("android_download_update", {
    url: remote.apkUrl,
    sha256: remote.sha256,
    onProgress: on_progress,
  });
}

export async function installAndroidUpdate(localPath: string): Promise<void> {
  if (!isTauriAndroid()) {
    throw new Error("仅 Android 支持应用内更新");
  }
  await invoke("android_install_update", { path: localPath });
}
