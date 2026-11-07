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
