"use client";

import { get, set, del, keys } from "idb-keyval";
import type { AssetMeta } from "../types";

export const ASSET_BLOB_PREFIX = "langhuan-asset:";
export const ASSET_META_KEY = "langhuan-asset-meta";

function blobKey(id: string): string {
  return `${ASSET_BLOB_PREFIX}${id}`;
}

export async function putAssetBlob(id: string, blob: Blob): Promise<void> {
  await set(blobKey(id), blob);
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  try {
    const v = await get<Blob>(blobKey(id));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function deleteAssetBlob(id: string): Promise<void> {
  await del(blobKey(id));
}

/** Object URL cache so the same asset reuses one blob URL per session. */
const urlCache = new Map<string, string>();

export async function getAssetObjectUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await getAssetBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function revokeAssetObjectUrl(id: string): void {
  const u = urlCache.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    urlCache.delete(id);
  }
}

export async function loadAssetMetaList(): Promise<AssetMeta[]> {
  try {
    const list = await get<AssetMeta[]>(ASSET_META_KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveAssetMetaList(list: AssetMeta[]): Promise<void> {
  await set(ASSET_META_KEY, list);
}

export async function clearAllAssetBlobs(): Promise<void> {
  try {
    const all = await keys();
    for (const k of all) {
      if (typeof k === "string" && k.startsWith(ASSET_BLOB_PREFIX)) {
        await del(k);
      }
    }
  } catch {
    /* ignore */
  }
  for (const id of [...urlCache.keys()]) revokeAssetObjectUrl(id);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
