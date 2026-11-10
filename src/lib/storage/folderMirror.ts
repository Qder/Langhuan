"use client";

import type { AssetMeta, Document } from "../types";
import { blobToBase64, putLibraryAsset } from "./contentApi";
import { normalizeImportedPath } from "../importable";
import { getAssetBlob, putAssetBlob } from "../assets/store";
import {
  isAndroidSafAvailable,
  scanSafTree,
  writeSafBytes,
  writeSafText,
  type SafAsset,
} from "../android/saf";
import {
  buildIndexFromDocuments,
  collectExternalSnapshot,
  formatAssetSkipSummary,
  getStoredHandle,
  isFsAccessSupported,
  planForcePullAssets,
  planForcePullFromDisk,
  syncOutAll,
  writeIndex,
  type DiskAsset,
  type DiskDoc,
  type FsIndex,
  type SyncInResult,
  type SyncOutResult,
} from "./fsSync";
import { planIngestibleDiskAssets } from "./syncInAssets";
import { FS_INDEX_DIR, FS_INDEX_FILE } from "./constants";
import { normalizeNewlines } from "../utils";

export type MirrorBackend = "fsa" | "saf";

export type DirectedPushResult = SyncOutResult;

export type DirectedPullResult = {
  documents: Document[];
  assets: AssetMeta[];
  inn: SyncInResult;
  truncated: boolean;
  assetSkipSummary: string;
};

export function getMirrorBackend(): MirrorBackend | null {
  if (typeof window === "undefined") return null;
  if (isFsAccessSupported()) return "fsa";
  if (isAndroidSafAvailable()) return "saf";
  return null;
}

function safDocsToDisk(docs: { path: string; content: string; mtime: number; size: number }[]): DiskDoc[] {
  return docs.map((d) => {
    const path = normalizeImportedPath(d.path.replace(/\.htm$/i, ".html"));
    return {
      path,
      content: normalizeNewlines(d.content),
      mtime: d.mtime || Date.now(),
      size: d.size || 0,
    };
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

function safAssetsToDisk(assets: SafAsset[]): DiskAsset[] {
  return assets.map((a) => ({
    path: a.path,
    mtime: a.mtime || Date.now(),
    size: a.size || 0,
    blob: base64ToBlob(a.base64, a.mime),
    mime: a.mime || "application/octet-stream",
  }));
}

async function persistPulledAssets(
  next: AssetMeta[],
  upserted: string[],
  diskAssets: DiskAsset[]
): Promise<string[]> {
  const errors: string[] = [];
  const byPath = new Map(next.map((a) => [a.path, a]));
  const diskByPath = new Map(diskAssets.map((a) => [a.path, a]));
  for (const path of upserted) {
    const meta = byPath.get(path);
    const disk = diskByPath.get(path);
    if (!meta || !disk) continue;
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
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}

async function pushViaSaf(
  documents: Document[],
  assets: AssetMeta[]
): Promise<DirectedPushResult> {
  const errors: string[] = [];
  let written = 0;
  for (const doc of documents) {
    try {
      await writeSafText(doc.path, doc.content);
      written += 1;
    } catch (e) {
      errors.push(`${doc.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const mirrored: string[] = [];
  for (const a of assets) {
    try {
      const blob = await getAssetBlob(a.id);
      if (!blob) {
        errors.push(`${a.path}: 附件二进制缺失`);
        continue;
      }
      await writeSafBytes(a.path, await blobToBase64(blob));
      written += 1;
      mirrored.push(a.path);
    } catch (e) {
      errors.push(`${a.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const now = Date.now();
  try {
    const index = buildIndexFromDocuments(documents, now, mirrored);
    await writeSafText(
      `${FS_INDEX_DIR}/${FS_INDEX_FILE}`,
      JSON.stringify(index, null, 2) + "\n"
    );
  } catch (e) {
    errors.push(`index: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { written, errors };
}

export async function pushLibraryToMirror(
  documents: Document[],
  assets: AssetMeta[]
): Promise<DirectedPushResult> {
  const backend = getMirrorBackend();
  if (backend === "saf") return pushViaSaf(documents, assets);
  if (backend === "fsa") {
    const handle = await getStoredHandle();
    if (!handle) throw new Error("未绑定文件夹");
    return syncOutAll(handle, documents, assets);
  }
  throw new Error("当前环境不能写入本地文件夹");
}

export async function pullLibraryFromMirror(
  documents: Document[],
  assets: AssetMeta[]
): Promise<DirectedPullResult> {
  const backend = getMirrorBackend();
  let diskDocs: DiskDoc[] = [];
  let diskAssets: DiskAsset[] = [];
  let index: FsIndex = {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: Date.now(),
    documents: {},
    assets: {},
  };
  let truncated = false;
  const priorSkips: { path: string; reason: string }[] = [];

  if (backend === "saf") {
    const scan = await scanSafTree();
    diskDocs = safDocsToDisk(scan.docs);
    diskAssets = safAssetsToDisk(scan.assets);
    truncated = scan.truncated;
  } else if (backend === "fsa") {
    const handle = await getStoredHandle();
    if (!handle) throw new Error("未绑定文件夹");
    const snap = await collectExternalSnapshot(handle, documents);
    diskDocs = snap.docs;
    diskAssets = snap.assets;
    index = snap.index;
    truncated = snap.truncatedAssets;
    priorSkips.push(...snap.skippedAssets);
  } else {
    throw new Error("当前环境不能读取本地文件夹");
  }

  const ingest = planIngestibleDiskAssets(
    diskAssets.map((a) => ({ path: a.path, size: a.size, mtime: a.mtime })),
    [...documents, ...diskDocs]
  );
  const accepted = new Set(ingest.accepted.map((a) => a.path));
  diskAssets = diskAssets.filter((a) => accepted.has(a.path));
  const assetSkipSummary = formatAssetSkipSummary(
    [...priorSkips, ...ingest.skipped],
    truncated || ingest.truncated
  );

  const planned = planForcePullFromDisk(documents, diskDocs, index);
  const pulledAssets = planForcePullAssets(
    assets,
    diskAssets.map((a) => ({
      path: a.path,
      mime: a.mime,
      size: a.size,
      mtime: a.mtime,
    }))
  );
  const assetErrors = await persistPulledAssets(
    pulledAssets.assets,
    pulledAssets.upserted,
    diskAssets
  );
  planned.result.errors.push(...assetErrors);

  if (backend === "fsa") {
    const handle = await getStoredHandle();
    if (handle) {
      try {
        await writeIndex(
          handle,
          buildIndexFromDocuments(
            planned.next,
            Date.now(),
            pulledAssets.upserted
          )
        );
      } catch {
        /* index best-effort */
      }
    }
  } else if (backend === "saf") {
    try {
      const nextIndex = buildIndexFromDocuments(
        planned.next,
        Date.now(),
        pulledAssets.upserted
      );
      await writeSafText(
        `${FS_INDEX_DIR}/${FS_INDEX_FILE}`,
        JSON.stringify(nextIndex, null, 2) + "\n"
      );
    } catch {
      /* index best-effort */
    }
  }

  if (backend === "fsa") {
    truncated = truncated || ingest.truncated;
  }
  return {
    documents: planned.next,
    assets: pulledAssets.assets,
    inn: planned.result,
    truncated,
    assetSkipSummary,
  };
}
