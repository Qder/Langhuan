"use client";

import { get, set, del } from "idb-keyval";
import type { AssetMeta, Document } from "../types";
import { libraryDocTypeFromPath } from "../importable";
import { FS_HANDLE_KEY, FS_INDEX_DIR, FS_INDEX_FILE } from "./constants";
import { safeRelPath } from "./pathSanitize";
import { normalizeNewlines } from "../utils";
export { safeRelPath } from "./pathSanitize";
import { getAssetBlob } from "../assets/store";

export type FsIndexEntry = {
  id: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
};

export type FsIndex = {
  format: "langhuan-fs-index";
  version: 1;
  updatedAt: number;
  /** Relative library path → meta (tags live in file content). */
  documents: Record<string, FsIndexEntry>;
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

/** True when showDirectoryPicker exists (Chrome / Edge / Opera). */
export function isFsAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
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
      if (name.startsWith(".")) continue;
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
        if (name === FS_INDEX_DIR || name === "node_modules" || name === ".git") continue;
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


const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

function utf8Size(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

/** Recursively list image files under root (skip dot / .langhuan). */
export async function scanDiskAssets(root: FileSystemDirectoryHandle): Promise<DiskAsset[]> {
  const out: DiskAsset[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, entry] of dir.entries()) {
      if (name.startsWith(".")) continue;
      if (entry.kind === "file") {
        if (!IMAGE_RE.test(name)) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        const rel = prefix ? `${prefix}/${name}` : name;
        const mime =
          file.type ||
          (name.toLowerCase().endsWith(".png")
            ? "image/png"
            : name.toLowerCase().endsWith(".webp")
              ? "image/webp"
              : name.toLowerCase().endsWith(".gif")
                ? "image/gif"
                : "image/jpeg");
        out.push({
          path: rel,
          mtime: file.lastModified,
          size: file.size,
          blob: file,
          mime,
        });
      } else if (entry.kind === "directory") {
        if (name === FS_INDEX_DIR || name === "node_modules" || name === ".git") continue;
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

  for (const [path, asset] of assetByPath) {
    if (seenAssets.has(path)) continue;
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

export async function collectExternalSnapshot(
  root: FileSystemDirectoryHandle
): Promise<{ docs: DiskDoc[]; assets: DiskAsset[]; index: FsIndex }> {
  const [docs, assets, index] = await Promise.all([
    scanDiskDocs(root),
    scanDiskAssets(root),
    readIndex(root),
  ]);
  return { docs, assets, index };
}

export function emptyIndex(): FsIndex {
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: Date.now(),
    documents: {},
  };
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
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export function buildIndexFromDocuments(docs: Document[], now = Date.now()): FsIndex {
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
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: now,
    documents,
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
  for (const a of assets) {
    try {
      const blob = await getAssetBlob(a.id);
      if (!blob) {
        errors.push(`${a.path}: 附件二进制缺失`);
        continue;
      }
      await writeBinaryFile(root, a.path, blob);
      written += 1;
    } catch (e) {
      errors.push(`${a.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    await writeIndex(root, buildIndexFromDocuments(documents, now));
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
  return true;
}
