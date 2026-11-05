import { isTauriRuntime } from "@/lib/storage/contentApi";

export type UpdateInfo = {
  currentVersion: string;
  version: string;
  notes: string;
  date?: string;
};

export type Progress = { received: number; total: number | null };

type UpdaterHandle = {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  downloadAndInstall: (
    onEvent?: (event: {
      event: string;
      data?: { contentLength?: number; chunkLength?: number };
    }) => void
  ) => Promise<void>;
  close?: () => Promise<void>;
};

export function isTauriAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return isTauriRuntime() && /android/i.test(navigator.userAgent);
}

export function isTauriDesktop(): boolean {
  return isTauriRuntime() && !isTauriAndroid();
}

/** Map plugin/network errors to a short Chinese sentence. Never dump stack traces. */
export function explainUpdaterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.toLowerCase();
  if (!raw.trim()) return "检查更新失败，请稍后重试。";
  if (
    /signature|minisign|checksum|invalid key|public key|ed25519|failed to verify/i.test(
      raw
    )
  ) {
    return "更新包签名校验失败，没有安装。请从 GitHub Releases 核对来源后再试。";
  }
  if (
    /failed to fetch|network|dns|timed out|timeout|error sending|connection|econnrefused|connect error|could not connect|unavailable|502|503|504|err_internet/i.test(
      msg
    )
  ) {
    return "连不上更新服务器。检查网络后重试。";
  }
  if (/404|not found/.test(msg)) {
    return "找不到更新清单。可能还没有发布过安装包。";
  }
  if (/http:|insecure|tls|https/.test(msg)) {
    return "更新通道必须使用 HTTPS。当前清单地址不可用。";
  }
  return `检查更新失败：${raw.slice(0, 160)}`;
}

export async function currentAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return "浏览器";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function checkForDesktopUpdate(): Promise<UpdateInfo | null> {
  if (!isTauriDesktop()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = (await check({ timeout: 12_000 })) as UpdaterHandle | null;
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    notes: (update.body || "").trim() || "（此版本没有更新说明）",
    date: update.date,
  };
}

export async function downloadAndInstallDesktopUpdate(
  onProgress?: (p: Progress) => void
): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("当前环境不能安装桌面更新");
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = (await check({ timeout: 12_000 })) as UpdaterHandle | null;
  if (!update) {
    throw new Error("已经没有可安装的更新");
  }
  let received = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data?.contentLength ?? null;
      received = 0;
      onProgress?.({ received, total });
    } else if (event.event === "Progress") {
      received += event.data?.chunkLength ?? 0;
      onProgress?.({ received, total });
    }
  });
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // Windows installer already exits the app after launching setup.
  }
}
