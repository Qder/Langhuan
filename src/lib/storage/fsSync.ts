"use client";

import { get, set, del } from "idb-keyval";
import type { AssetMeta, Document } from "../types";
import { libraryDocTypeFromPath } from "../importable";
import { FS_HANDLE_KEY, FS_INDEX_DIR, FS_INDEX_FILE } from "./constants";
import {
  formatAssetSkipSummary,
  mimeForSyncAsset,
  planIngestibleDiskAssets,
  shouldIgnoreSyncName,
  type AssetScanSkip,
} from "./syncInAssets";
import { safeRelPath } from "./pathSanitize";
import { normalizeNewlines } from "../utils";
import { directoryPickerSupported } from "../platform";
export { safeRelPath } from "./pathSanitize";
import { getAssetBlob } from "../assets/store";

export type FsIndexEntry = {
  id: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
};

/** Bound-folder mirror record for an attachment (keyed by library path). */
export type FsAssetIndexEntry = {
  lastSyncedAt: number;
};

export type FsIndex = {
  format: "langhuan-fs-index";
  version: 1;
  updatedAt: number;
  /** Relative library path → meta (tags live in file content). */
  documents: Record<string, FsIndexEntry>;
  /**
   * Attachments successfully mirrored to the bound folder.
   * Old version:1 indexes omit this field — treat as {}.
   */
  assets?: Record<string, FsAssetIndexEntry>;
};

export type DiskDoc = {
  path: string;
  content: string;
  mtime: number;
  size: number;
};

export type DiskAsset = {
  path: string;
  mtime: number;
  size: number;
  blob: Blob;
  mime: string;
};

export type { AssetScanSkip };

export type DiskAssetScan = {
  assets: DiskAsset[];
  skipped: AssetScanSkip[];
  truncated: boolean;
};

export type ExternalSnapshot = {
  docs: DiskDoc[];
  assets: DiskAsset[];
  index: FsIndex;
  skippedAssets: AssetScanSkip[];
  truncatedAssets: boolean;
};

export type ExternalChangeKind = "add" | "modify" | "delete" | "conflict";

export type ExternalChange = {
  path: string;
  entity: "doc" | "asset";
  change: ExternalChangeKind;
  diskMtime?: number;
  diskSize?: number;
  libraryUpdatedAt?: number;
  /** Human label for UI */
  detail?: string;
  /** Conflict preview: content/ side (≤ ~12 lines). */
  libraryExcerpt?: string;
  /** Conflict preview: disk side (≤ ~12 lines). */
  diskExcerpt?: string;
};

/** First N lines for conflict side-by-side preview. */
export function excerptForCompare(text: string, maxLines = 12): string {
  const lines = String(text ?? "").split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n") + "\n…";
}


export type DetectExternalResult = {
  changes: ExternalChange[];
  docs: DiskDoc[];
  assets: DiskAsset[];
};

export type SyncOutResult = {
  written: number;
  errors: string[];
};

export type SyncInResult = {
  imported: number;
  updated: number;
  conflicts: string[];
  unchanged: number;
  errors: string[];
};

export type BidirectionalSyncResult = {
  out: SyncOutResult;
  inn: SyncInResult;
};

/**
 * True when the *real* File System Access API is usable (Chrome / Edge / Opera).
 *
 * Android WebView 也挂了 `showDirectoryPicker`，但 Tauri 的
 * `RustWebChromeClient.showFilePicker` 在 `intent.type` 为 null 时 NPE，
 * 进程直接被杀（见 STATUS-android.md）。所以 Android 一律当不支持，
 * 上层退回 `<input type="file" webkitdirectory>` 那条路。
 */
export function isFsAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return directoryPickerSupported({
    hasShowDirectoryPicker: typeof window.showDirectoryPicker === "function",
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
  });
}

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === "undefined") return null;
  try {
    const h = await get<FileSystemDirectoryHandle>(FS_HANDLE_KEY);
    return h ?? null;
  } catch {
    return null;
  }
}

export async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await set(FS_HANDLE_KEY, handle);
}

export async function clearStoredHandle(): Promise<void> {
  await del(FS_HANDLE_KEY);
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "readwrite"
): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode };
  try {
    if (typeof handle.queryPermission === "function") {
      const q = await handle.queryPermission(opts);
      if (q === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      const r = await handle.requestPermission(opts);
      return r === "granted";
    }
    // Older / stub: assume granted if we can get the handle
    return true;
  } catch {
    return false;
  }
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFsAccessSupported()) return null;
  try {
    return await window.showDirectoryPicker!({
      id: "langhuan-library",
      mode: "readwrite",
    });
  } catch {
    // user cancelled
    return null;
  }
}

async function ensureDir(
  root: FileSystemDirectoryHandle,
  relDir: string
): Promise<FileSystemDirectoryHandle> {
  const parts = safeRelPath(relDir).split("/").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  return cur;
}

/** Ensure a relative library folder exists on the bound local directory (best-effort). */
export async function ensureLibraryDir(relDir: string): Promise<boolean> {
  const handle = await getStoredHandle();
  if (!handle) return false;
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) return false;
  const path = safeRelPath(relDir);
  if (!path) return false;
  await ensureDir(handle, path);
  return true;
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  content: string
): Promise<void> {
  const path = safeRelPath(relPath);
  if (!path) throw new Error("空路径");
  const parts = path.split("/");
  const name = parts.pop()!;
  const dir = parts.length ? await ensureDir(root, parts.join("/")) : root;
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

export async function readTextFile(
  root: FileSystemDirectoryHandle,
  relPath: string
): Promise<{ content: string; mtime: number } | null> {
  const path = safeRelPath(relPath);
  if (!path) return null;
  const parts = path.split("/");
  const name = parts.pop()!;
  try {
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return { content: normalizeNewlines(await file.text()), mtime: file.lastModified };
  } catch {
    return null;
  }
}

/** Recursively list .md / .html / .htm / .txt under root; skip .langhuan and dot dirs. */
export async function scanDiskDocs(root: FileSystemDirectoryHandle): Promise<DiskDoc[]> {
  const out: DiskDoc[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, entry] of dir.entries()) {
      if (shouldIgnoreSyncName(name)) continue;
      if (entry.kind === "file") {
        if (!/\.(md|html|htm|txt)$/i.test(name)) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        let rel = prefix ? `${prefix}/${name}` : name;
        if (rel.toLowerCase().endsWith(".txt")) {
          rel = rel.replace(/\.txt$/i, ".md");
        }
        if (rel.toLowerCase().endsWith(".htm")) {
          rel = rel.replace(/\.htm$/i, ".html");
        }
        const text = normalizeNewlines(await file.text());
        out.push({
          path: rel,
          content: text,
          mtime: file.lastModified,
          size: file.size,
        });
      } else if (entry.kind === "directory") {
        if (shouldIgnoreSyncName(name)) continue;
        await walk(
          entry as FileSystemDirectoryHandle,
          prefix ? `${prefix}/${name}` : name
        );
      }
    }
  };
  await walk(root, "");
  return out;
}


function utf8Size(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

/**
 * Recursively list candidate attachment files under root (images / pdf, etc.).
 * Blobs are only read after {@link planIngestibleDiskAssets} accepts a path.
 */
export async function scanDiskAssets(
  root: FileSystemDirectoryHandle,
  docs: Array<{ path: string; content: string }> = []
): Promise<DiskAssetScan> {
  const candidates: Array<{ path: string; size: number; mtime: number; file: File }> = [];
  const skipped: AssetScanSkip[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, entry] of dir.entries()) {
      if (shouldIgnoreSyncName(name)) continue;
      if (entry.kind === "file") {
        const rel = prefix ? `${prefix}/${name}` : name;
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          candidates.push({
            path: rel,
            size: file.size,
            mtime: file.lastModified,
            file,
          });
        } catch (e) {
          skipped.push({
            path: rel,
            reason: `读取失败：${e instanceof Error ? e.message : String(e)}`,
          });
        }
      } else if (entry.kind === "directory") {
        await walk(
          entry as FileSystemDirectoryHandle,
          prefix ? `${prefix}/${name}` : name
        );
      }
    }
  };
  await walk(root, "");
  const planned = planIngestibleDiskAssets(candidates, docs);
  const accepted = new Map(planned.accepted.map((a) => [a.path, a]));
  const assets: DiskAsset[] = [];
  for (const c of candidates) {
    if (!accepted.has(c.path)) continue;
    assets.push({
      path: c.path,
      mtime: c.mtime,
      size: c.size,
      blob: c.file,
      mime: mimeForSyncAsset(c.path, c.file.type),
    });
  }
  return {
    assets,
    skipped: [...skipped, ...planned.skipped],
    truncated: planned.truncated,
  };
}

export { formatAssetSkipSummary };

/**
 * Compare bound folder vs library using mtime/size (no continuous watch).
 * Both-sides dirty →「conflict」(keep content/ on apply); never silent overwrite.
 */
export function detectExternalChanges(
  library: Document[],
  assets: AssetMeta[],
  diskDocs: DiskDoc[],
  diskAssets: Omit<DiskAsset, "blob" | "mime">[],
  index: FsIndex
): ExternalChange[] {
  const changes: ExternalChange[] = [];
  const libByPath = new Map(library.map((d) => [safeRelPath(d.path), d]));
  const assetByPath = new Map(assets.map((a) => [safeRelPath(a.path), a]));
  const seenDocs = new Set<string>();
  const seenAssets = new Set<string>();

  for (const file of diskDocs) {
    const path = safeRelPath(file.path);
    if (!path) continue;
    seenDocs.add(path);
    const existing = libByPath.get(path);
    const meta = index.documents[path];
    const lastSynced = meta?.lastSyncedAt ?? 0;
    if (!existing) {
      changes.push({
        path,
        entity: "doc",
        change: "add",
        diskMtime: file.mtime,
        diskSize: file.size,
        detail: "磁盘新增",
      });
      continue;
    }
    const libSize = utf8Size(existing.content);
    const sizeDiff = file.size !== libSize;
    const contentDiff = existing.content !== file.content;
    if (!contentDiff && !sizeDiff) continue;
    const diskChanged = file.mtime > lastSynced || sizeDiff;
    const libChanged = existing.updatedAt > lastSynced;
    if (diskChanged && libChanged && contentDiff) {
      changes.push({
        path,
        entity: "doc",
        change: "conflict",
        diskMtime: file.mtime,
        diskSize: file.size,
        libraryUpdatedAt: existing.updatedAt,
        detail: "两侧均有改动 · 将保留 content/",
        libraryExcerpt: excerptForCompare(existing.content),
        diskExcerpt: excerptForCompare(file.content),
      });
    } else if (diskChanged && contentDiff) {
      changes.push({
        path,
        entity: "doc",
        change: "modify",
        diskMtime: file.mtime,
        diskSize: file.size,
        libraryUpdatedAt: existing.updatedAt,
        detail: "磁盘较新",
      });
    }
  }

  for (const [path, doc] of libByPath) {
    if (seenDocs.has(path)) continue;
    // Only report delete when the path was previously mirrored in the FS index.
    const meta = index.documents[path];
    if (!meta) continue;
    changes.push({
      path,
      entity: "doc",
      change: "delete",
      libraryUpdatedAt: doc.updatedAt,
      detail: "磁盘上已不存在",
    });
  }

  for (const file of diskAssets) {
    const path = safeRelPath(file.path);
    if (!path) continue;
    seenAssets.add(path);
    const existing = assetByPath.get(path);
    if (!existing) {
      changes.push({
        path,
        entity: "asset",
        change: "add",
        diskMtime: file.mtime,
        diskSize: file.size,
        detail: "磁盘新图片",
      });
      continue;
    }
    if (existing.size !== file.size || (file.mtime && file.mtime > existing.createdAt)) {
      if (existing.size !== file.size) {
        changes.push({
          path,
          entity: "asset",
          change: "modify",
          diskMtime: file.mtime,
          diskSize: file.size,
          detail: "图片大小变化",
        });
      }
    }
  }

  const mirroredAssets = index.assets ?? {};
  for (const [path, asset] of assetByPath) {
    if (seenAssets.has(path)) continue;
    // Only report delete for attachments that were previously mirrored out.
    if (!mirroredAssets[path]) continue;
    changes.push({
      path,
      entity: "asset",
      change: "delete",
      libraryUpdatedAt: asset.createdAt,
      detail: "磁盘上已不存在（需勾选才会从库删除）",
    });
  }

  const order = { add: 0, modify: 1, conflict: 2, delete: 3 };
  changes.sort(
    (a, b) => order[a.change] - order[b.change] || a.path.localeCompare(b.path, "zh")
  );
  return changes;
}

export type ApplyExternalPullResult = {
  documents: Document[];
  assets: AssetMeta[];
  applied: ExternalChange[];
  skippedConflicts: string[];
  errors: string[];
};

/**
 * Apply confirmed external changes into library snapshots.
 * Conflicts are skipped (content/ wins). Deletes remove docs from the list.
 * Asset blobs must be supplied via diskAssets map.
 */
export function applyExternalPull(
  library: Document[],
  assets: AssetMeta[],
  diskDocs: DiskDoc[],
  diskAssets: DiskAsset[],
  index: FsIndex,
  selected: ExternalChange[],
  now = Date.now()
): ApplyExternalPullResult {
  const docMap = new Map(library.map((d) => [safeRelPath(d.path), { ...d }]));
  const assetMap = new Map(assets.map((a) => [safeRelPath(a.path), { ...a }]));
  const diskDocMap = new Map(diskDocs.map((d) => [safeRelPath(d.path), d]));
  const diskAssetMap = new Map(diskAssets.map((a) => [safeRelPath(a.path), a]));
  const applied: ExternalChange[] = [];
  const skippedConflicts: string[] = [];
  const errors: string[] = [];

  for (const ch of selected) {
    const path = safeRelPath(ch.path);
    if (!path) continue;
    if (ch.change === "conflict") {
      skippedConflicts.push(path);
      continue;
    }
    if (ch.change === "delete") {
      if (ch.entity === "doc") {
        docMap.delete(path);
      } else {
        assetMap.delete(path);
      }
      applied.push(ch);
      continue;
    }
    if (ch.entity === "doc") {
      const file = diskDocMap.get(path);
      if (!file) {
        errors.push(`${path}: 磁盘文件缺失`);
        continue;
      }
      const type = libraryDocTypeFromPath(path);
      const existing = docMap.get(path);
      const meta = index.documents[path];
      if (!existing) {
        docMap.set(path, {
          id: meta?.id || `fs_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`,
          path,
          type,
          content: file.content,
          starred: meta?.starred ?? false,
          createdAt: meta?.createdAt ?? (file.mtime || now),
          updatedAt: file.mtime || now,
        });
      } else {
        docMap.set(path, {
          ...existing,
          content: file.content,
          type,
          updatedAt: file.mtime || now,
        });
      }
      applied.push(ch);
    } else {
      const file = diskAssetMap.get(path);
      if (!file) {
        errors.push(`${path}: 磁盘附件缺失`);
        continue;
      }
      const existing = assetMap.get(path);
      if (!existing) {
        assetMap.set(path, {
          id: `fs_asset_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`,
          path,
          mime: file.mime,
          size: file.size,
          createdAt: file.mtime || now,
        });
      } else {
        assetMap.set(path, {
          ...existing,
          mime: file.mime || existing.mime,
          size: file.size,
        });
      }
      applied.push(ch);
    }
  }

  return {
    documents: Array.from(docMap.values()),
    assets: Array.from(assetMap.values()),
    applied,
    skippedConflicts,
    errors,
  };
}

export type ApplyDiskOverwriteResult = {
  documents: Document[];
  overwritten: string[];
  errors: string[];
};

/**
 * Explicit conflict resolution: replace library content/ with disk for listed paths only.
 * Paths not listed are untouched. Does not treat checkbox-selected conflicts as overwrite.
 */
export function applyDiskOverwrite(
  library: Document[],
  diskDocs: DiskDoc[],
  overwritePaths: string[],
  now = Date.now()
): ApplyDiskOverwriteResult {
  const docMap = new Map(library.map((d) => [safeRelPath(d.path), { ...d }]));
  const diskDocMap = new Map(diskDocs.map((d) => [safeRelPath(d.path), d]));
  const overwritten: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const raw of overwritePaths) {
    const path = safeRelPath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const file = diskDocMap.get(path);
    if (!file) {
      errors.push(`${path}: 磁盘文件缺失`);
      continue;
    }
    const existing = docMap.get(path);
    if (!existing) {
      errors.push(`${path}: 库中无此文档`);
      continue;
    }
    docMap.set(path, {
      ...existing,
      content: file.content,
      type: libraryDocTypeFromPath(path),
      updatedAt: now,
    });
    overwritten.push(path);
  }

  return {
    documents: Array.from(docMap.values()),
    overwritten,
    errors,
  };
}

/** Patch lastSyncedAt / updatedAt for paths just overwritten from disk. */
export function patchIndexAfterDiskOverwrite(
  index: FsIndex,
  documents: Document[],
  overwritten: string[],
  now = Date.now()
): FsIndex {
  const byPath = new Map(
    documents.map((d) => [safeRelPath(d.path), d] as const)
  );
  const nextDocs = { ...index.documents };
  for (const raw of overwritten) {
    const path = safeRelPath(raw);
    if (!path) continue;
    const doc = byPath.get(path);
    if (!doc) continue;
    nextDocs[path] = {
      id: doc.id,
      starred: doc.starred,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastSyncedAt: now,
    };
  }
  return {
    ...index,
    updatedAt: now,
    documents: nextDocs,
    assets: { ...(index.assets ?? {}) },
  };
}

export async function collectExternalSnapshot(
  root: FileSystemDirectoryHandle,
  libraryDocs: Array<{ path: string; content: string }> = []
): Promise<ExternalSnapshot> {
  const [docs, index] = await Promise.all([
    scanDiskDocs(root),
    readIndex(root),
  ]);
  const scanned = await scanDiskAssets(root, [...libraryDocs, ...docs]);
  return {
    docs,
    assets: scanned.assets,
    index,
    skippedAssets: scanned.skipped,
    truncatedAssets: scanned.truncated,
  };
}

export function emptyIndex(): FsIndex {
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: Date.now(),
    documents: {},
    assets: {},
  };
}

/** Compat: old version:1 indexes without `assets` → empty table. */
export function normalizeFsIndex(index: FsIndex): FsIndex {
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: index.updatedAt || Date.now(),
    documents:
      index.documents && typeof index.documents === "object" ? index.documents : {},
    assets: index.assets && typeof index.assets === "object" ? index.assets : {},
  };
}

/** Record paths that were successfully mirrored to the bound folder. */
export function markAssetsSynced(
  index: FsIndex,
  paths: string[],
  now = Date.now()
): FsIndex {
  const assets = { ...(index.assets ?? {}) };
  for (const raw of paths) {
    const path = safeRelPath(raw);
    if (!path) continue;
    assets[path] = { lastSyncedAt: now };
  }
  return { ...index, updatedAt: now, assets };
}

/** Drop mirrored-asset records after a confirmed external delete. */
export function unmarkAssetsSynced(
  index: FsIndex,
  paths: string[],
  now = Date.now()
): FsIndex {
  const assets = { ...(index.assets ?? {}) };
  for (const raw of paths) {
    const path = safeRelPath(raw);
    if (!path) continue;
    delete assets[path];
  }
  return { ...index, updatedAt: now, assets };
}

/**
 * Rebuild document index and patch asset mirror table from a confirmed pull.
 * Failed asset paths are left untouched in the assets table.
 */
export function buildIndexAfterExternalPull(
  previous: FsIndex,
  documents: Document[],
  applied: ExternalChange[],
  failedAssetPaths: Iterable<string> = [],
  now = Date.now()
): FsIndex {
  const failed = new Set(
    Array.from(failedAssetPaths, (p) => safeRelPath(p)).filter(Boolean) as string[]
  );
  const next = buildIndexFromDocuments(documents, now);
  next.assets = { ...(previous.assets ?? {}) };
  for (const ch of applied) {
    if (ch.entity !== "asset") continue;
    const path = safeRelPath(ch.path);
    if (!path || failed.has(path)) continue;
    if (ch.change === "delete") {
      delete next.assets[path];
    } else if (ch.change === "add" || ch.change === "modify") {
      next.assets[path] = { lastSyncedAt: now };
    }
  }
  return next;
}

export async function readIndex(root: FileSystemDirectoryHandle): Promise<FsIndex> {
  const raw = await readTextFile(root, `${FS_INDEX_DIR}/${FS_INDEX_FILE}`);
  if (!raw) return emptyIndex();
  try {
    const parsed = JSON.parse(raw.content) as FsIndex;
    if (parsed.format !== "langhuan-fs-index") return emptyIndex();
    if (!parsed.documents || typeof parsed.documents !== "object") {
      return emptyIndex();
    }
    return normalizeFsIndex(parsed);
  } catch {
    return emptyIndex();
  }
}

export function buildIndexFromDocuments(
  docs: Document[],
  now = Date.now(),
  mirroredAssets: string[] = []
): FsIndex {
  const documents: Record<string, FsIndexEntry> = {};
  for (const d of docs) {
    const path = safeRelPath(d.path);
    if (!path) continue;
    documents[path] = {
      id: d.id,
      starred: d.starred,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lastSyncedAt: now,
    };
  }
  const assets: Record<string, FsAssetIndexEntry> = {};
  for (const raw of mirroredAssets) {
    const path = safeRelPath(raw);
    if (!path) continue;
    assets[path] = { lastSyncedAt: now };
  }
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: now,
    documents,
    assets,
  };
}

export async function writeIndex(root: FileSystemDirectoryHandle, index: FsIndex): Promise<void> {
  await writeTextFile(
    root,
    `${FS_INDEX_DIR}/${FS_INDEX_FILE}`,
    JSON.stringify(index, null, 2) + "\n"
  );
}

export async function writeDocToDisk(
  root: FileSystemDirectoryHandle,
  doc: Document
): Promise<void> {
  const path = safeRelPath(doc.path);
  if (!path) throw new Error("文档路径无效");
  await writeTextFile(root, path, doc.content);
}

/**
 * Write-through for a single saved document. Returns false if unbound / no permission.
 */
export async function writeThroughDoc(doc: Document): Promise<boolean> {
  const handle = await getStoredHandle();
  if (!handle) return false;
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) return false;
  await writeDocToDisk(handle, doc);
  const index = await readIndex(handle);
  const path = safeRelPath(doc.path);
  const now = Date.now();
  index.documents[path] = {
    id: doc.id,
    starred: doc.starred,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastSyncedAt: now,
  };
  index.updatedAt = now;
  await writeIndex(handle, index);
  return true;
}

/** Dump entire library to the bound folder (library → disk). */
export async function syncOutAll(
  root: FileSystemDirectoryHandle,
  documents: Document[],
  assets: AssetMeta[] = []
): Promise<SyncOutResult> {
  const errors: string[] = [];
  let written = 0;
  const now = Date.now();
  for (const doc of documents) {
    try {
      await writeDocToDisk(root, doc);
      written += 1;
    } catch (e) {
      errors.push(`${doc.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const mirroredAssetPaths: string[] = [];
  for (const a of assets) {
    try {
      const blob = await getAssetBlob(a.id);
      if (!blob) {
        errors.push(`${a.path}: 附件二进制缺失`);
        continue;
      }
      await writeBinaryFile(root, a.path, blob);
      written += 1;
      mirroredAssetPaths.push(a.path);
    } catch (e) {
      errors.push(`${a.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    await writeIndex(root, buildIndexFromDocuments(documents, now, mirroredAssetPaths));
  } catch (e) {
    errors.push(`index: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { written, errors };
}

/**
 * Pull disk files into the in-memory document list (does not mutate store itself).
 * Conflict policy: if both sides changed since lastSyncedAt, **content/ (library) wins**
 * and the path is listed in `conflicts` (no silent overwrite). Orphan disk cleanup is out of scope.
 */
export function planSyncIn(
  library: Document[],
  disk: DiskDoc[],
  index: FsIndex
): {
  next: Document[];
  result: SyncInResult;
} {
  const byPath = new Map(library.map((d) => [safeRelPath(d.path), d]));
  const byId = new Map(library.map((d) => [d.id, d]));
  const nextMap = new Map(byPath);
  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  const conflicts: string[] = [];
  const errors: string[] = [];

  for (const file of disk) {
    const path = safeRelPath(file.path);
    if (!path) continue;
    const type = libraryDocTypeFromPath(path);
    const meta = index.documents[path];
    const existing = nextMap.get(path);

    if (!existing) {
      // Renamed on disk? If index id still points at another path in library, retarget.
      let id = meta?.id;
      let starred = meta?.starred ?? false;
      let createdAt = meta?.createdAt ?? file.mtime;
      if (id && byId.has(id)) {
        const old = byId.get(id)!;
        const oldPath = safeRelPath(old.path);
        if (oldPath !== path && nextMap.get(oldPath)?.id === id) {
          nextMap.delete(oldPath);
        }
        starred = old.starred;
        createdAt = old.createdAt;
      } else {
        id = id || `fs_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
      }
      const doc: Document = {
        id: id!,
        path,
        type,
        content: file.content,
        starred,
        createdAt,
        updatedAt: file.mtime || Date.now(),
      };
      nextMap.set(path, doc);
      byId.set(doc.id, doc);
      imported += 1;
      continue;
    }

    if (existing.content === file.content) {
      unchanged += 1;
      continue;
    }

    const lastSynced = meta?.lastSyncedAt ?? 0;
    const diskChanged = file.mtime > lastSynced;
    const idbChanged = existing.updatedAt > lastSynced;

    if (diskChanged && idbChanged) {
      // Both dirty → keep content/ (library); list path for the user. Never silent overwrite.
      conflicts.push(path);
      unchanged += 1;
      continue;
    }

    if (diskChanged || file.mtime > existing.updatedAt) {
      nextMap.set(path, {
        ...existing,
        content: file.content,
        type,
        updatedAt: file.mtime || Date.now(),
        starred: meta?.starred ?? existing.starred,
      });
      updated += 1;
      continue;
    }

    // Library newer — keep IDB; syncOut will have / will rewrite disk
    unchanged += 1;
  }

  return {
    next: Array.from(nextMap.values()),
    result: { imported, updated, conflicts, unchanged, errors },
  };
}

/**
 * User-picked direction: local folder overwrites the library at matching paths.
 * Does not delete library-only docs. Never reports conflicts (direction is explicit).
 */
export function planForcePullFromDisk(
  library: Document[],
  disk: DiskDoc[],
  index: FsIndex,
  now = Date.now()
): {
  next: Document[];
  result: SyncInResult;
} {
  const nextMap = new Map(library.map((d) => [safeRelPath(d.path), { ...d }]));
  const byId = new Map(library.map((d) => [d.id, d]));
  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  const errors: string[] = [];

  for (const file of disk) {
    const path = safeRelPath(file.path);
    if (!path) continue;
    const type = libraryDocTypeFromPath(path);
    const meta = index.documents[path];
    const existing = nextMap.get(path);

    if (!existing) {
      let id = meta?.id;
      let starred = meta?.starred ?? false;
      let createdAt = meta?.createdAt ?? file.mtime;
      if (id && byId.has(id)) {
        const old = byId.get(id)!;
        const oldPath = safeRelPath(old.path);
        if (oldPath !== path && nextMap.get(oldPath)?.id === id) {
          nextMap.delete(oldPath);
        }
        starred = old.starred;
        createdAt = old.createdAt;
      } else {
        id = id || `fs_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`;
      }
      const doc: Document = {
        id: id!,
        path,
        type,
        content: file.content,
        starred,
        createdAt,
        updatedAt: file.mtime || now,
      };
      nextMap.set(path, doc);
      byId.set(doc.id, doc);
      imported += 1;
      continue;
    }

    if (existing.content === file.content) {
      unchanged += 1;
      continue;
    }

    nextMap.set(path, {
      ...existing,
      content: file.content,
      type,
      updatedAt: file.mtime || now,
      starred: meta?.starred ?? existing.starred,
    });
    updated += 1;
  }

  return {
    next: Array.from(nextMap.values()),
    result: { imported, updated, conflicts: [], unchanged, errors },
  };
}

/** Directed pull: disk attachments upsert into the library; library-only assets stay. */
export function planForcePullAssets(
  library: AssetMeta[],
  disk: Array<{ path: string; mime: string; size: number; mtime?: number }>,
  now = Date.now()
): { assets: AssetMeta[]; upserted: string[] } {
  const map = new Map(library.map((a) => [safeRelPath(a.path), { ...a }]));
  const upserted: string[] = [];
  for (const file of disk) {
    const path = safeRelPath(file.path);
    if (!path) continue;
    const existing = map.get(path);
    if (!existing) {
      map.set(path, {
        id: `fs_asset_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`,
        path,
        mime: file.mime,
        size: file.size,
        createdAt: file.mtime || now,
      });
      upserted.push(path);
      continue;
    }
    map.set(path, {
      ...existing,
      mime: file.mime || existing.mime,
      size: file.size,
    });
    upserted.push(path);
  }
  return { assets: Array.from(map.values()), upserted };
}

/**
 * Bidirectional sync: pull newer disk files into library (conflicts keep content/),
 * then write full library to disk + refresh index.
 */
export async function syncBidirectional(
  root: FileSystemDirectoryHandle,
  library: Document[],
  assets: AssetMeta[] = []
): Promise<{ documents: Document[]; result: BidirectionalSyncResult }> {
  const index = await readIndex(root);
  let disk: DiskDoc[] = [];
  const innErrors: string[] = [];
  try {
    disk = await scanDiskDocs(root);
  } catch (e) {
    innErrors.push(e instanceof Error ? e.message : String(e));
  }
  const planned = planSyncIn(library, disk, index);
  planned.result.errors.push(...innErrors);

  const out = await syncOutAll(root, planned.next, assets);
  return {
    documents: planned.next,
    result: { out, inn: planned.result },
  };
}


/** Write a binary file under the bound folder (attachments). */
export async function writeBinaryFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  data: Blob | ArrayBuffer | Uint8Array
): Promise<void> {
  const path = safeRelPath(relPath);
  if (!path) throw new Error("路径无效");
  const parts = path.split("/").filter(Boolean);
  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileName = parts[parts.length - 1];
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  let chunk: Blob;
  if (data instanceof Blob) {
    chunk = data;
  } else if (data instanceof ArrayBuffer) {
    chunk = new Blob([data]);
  } else {
    chunk = new Blob([new Uint8Array(data)]);
  }
  await writable.write(chunk);
  await writable.close();
}

export async function writeThroughAssetBinary(
  relPath: string,
  data: Blob | ArrayBuffer | Uint8Array
): Promise<boolean> {
  const handle = await getStoredHandle();
  if (!handle) return false;
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) return false;
  await writeBinaryFile(handle, relPath, data);
  try {
    const index = await readIndex(handle);
    const next = markAssetsSynced(index, [relPath]);
    await writeIndex(handle, next);
  } catch {
    /* index best-effort after mirror write */
  }
  return true;
}
