import { invoke } from "@tauri-apps/api/core";
import { isTauriAndroidRuntime } from "@/lib/platform";

export type SafBoundInfo = {
  bound: boolean;
  uri: string;
  name: string;
  writable: boolean;
};

export type SafDoc = {
  path: string;
  content: string;
  mtime: number;
  size: number;
};

export type SafAsset = {
  path: string;
  base64: string;
  mime: string;
  mtime: number;
  size: number;
};

export type SafScan = {
  docs: SafDoc[];
  assets: SafAsset[];
  truncated: boolean;
  skipped: number;
};

export function isAndroidSafAvailable(): boolean {
  return isTauriAndroidRuntime();
}

export function isSafPickCancelled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /取消/.test(msg);
}

export async function pickSafTree(): Promise<SafBoundInfo | null> {
  try {
    return await invoke<SafBoundInfo>("android_saf_pick_tree");
  } catch (e) {
    if (isSafPickCancelled(e)) return null;
    throw e;
  }
}

export async function getSafBound(): Promise<SafBoundInfo> {
  return invoke<SafBoundInfo>("android_saf_bound");
}

export async function unbindSaf(): Promise<void> {
  await invoke("android_saf_unbind");
}

export async function scanSafTree(): Promise<SafScan> {
  const raw = await invoke<SafScan>("android_saf_scan");
  return {
    docs: Array.isArray(raw.docs) ? raw.docs : [],
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    truncated: !!raw.truncated,
    skipped: Number(raw.skipped) || 0,
  };
}

export async function writeSafText(path: string, content: string): Promise<void> {
  await invoke("android_saf_write_text", { path, content });
}

export async function writeSafBytes(path: string, base64: string): Promise<void> {
  await invoke("android_saf_write_bytes", { path, base64 });
}

export type SafProjectFile = {
  path: string;
  content: string;
};

export type SafProjectSkip = {
  path: string;
  reason: string;
};

export type SafProjectScan = {
  name: string;
  files: SafProjectFile[];
  skipped: SafProjectSkip[];
  truncated: boolean;
};

/**
 * One-shot 读码选目录：不会改写藏书阁已绑定的 SAF 树。
 * 取消选择返回 null；当前不是 Android 应用时抛出明确错误，不假装成功。
 */
export async function pickAndScanSafProject(): Promise<SafProjectScan | null> {
  if (!isAndroidSafAvailable()) {
    throw new Error(
      "当前环境不能选择系统文件夹。请用琅嬛 Android 应用，或改用「导入工程 zip」。"
    );
  }
  try {
    const raw = await invoke<SafProjectScan>("android_saf_pick_and_scan_project");
    return {
      name: String(raw?.name || "").trim() || "工程",
      files: Array.isArray(raw?.files) ? raw.files : [],
      skipped: Array.isArray(raw?.skipped) ? raw.skipped : [],
      truncated: !!raw?.truncated,
    };
  } catch (e) {
    if (isSafPickCancelled(e)) return null;
    throw e;
  }
}
