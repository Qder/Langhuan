/**
 * 藏书阁：把「笔记文件夹」打成的 zip 解成可导入的 docs/assets。
 *
 * 安卓 WebView 不能整目录授权（FSA 会 NPE；webkitdirectory 也选不了文件夹），
 * 所以笔记导入走 zip → 仍写入库 content/（经 importFiles / importAssets），
 * 与读码工程沙箱（不写 content/）不同。
 */
import JSZip from "jszip";
import {
  isImportableImagePath,
  isImportableLibraryPath,
  mimeForImportableImage,
  normalizeImportedPath,
} from "./importable";

export const LIBRARY_ZIP_MAX_FILES = 2000;
export const LIBRARY_ZIP_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const LIBRARY_ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Skip junk that is never a note folder. Lighter than IDE ignore (keep build/dist names). */
const LIBRARY_ZIP_IGNORED = new Set([
  "__MACOSX",
  ".DS_Store",
  "Thumbs.db",
  "node_modules",
  ".git",
  ".svn",
  ".hg",
]);

export type LibraryZipDoc = { path: string; content: string };
export type LibraryZipAsset = { path: string; blob: Blob; mime: string };

export type LibraryZipImportResult =
  | {
      ok: true;
      docs: LibraryZipDoc[];
      assets: LibraryZipAsset[];
      skipped: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Normalize zip entry; drop traversal and ignored segments. Keep top folder (like webkitRelativePath). */
export function normalizeLibraryZipPath(raw: string): string | null {
  const p = String(raw || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return null;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((seg) => seg === ".." || seg === ".")) return null;
  if (parts.some((seg) => LIBRARY_ZIP_IGNORED.has(seg))) return null;
  if (parts.some((seg) => seg.startsWith(".") && seg !== ".gitignore")) {
    return null;
  }
  return parts.join("/");
}

export async function parseLibraryNotesZip(
  zipData: ArrayBuffer | Blob | Uint8Array
): Promise<LibraryZipImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch {
    return { ok: false, error: "打不开这个 zip（文件损坏或不是 zip）" };
  }

  const entryByNorm = new Map<string, JSZip.JSZipObject>();
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const norm = normalizeLibraryZipPath(relativePath);
    if (!norm) return;
    if (!entryByNorm.has(norm)) entryByNorm.set(norm, entry);
  });

  if (!entryByNorm.size) {
    return {
      ok: false,
      error: "zip 里没有可用文件（或全被忽略规则过滤了）",
    };
  }

  const docs: LibraryZipDoc[] = [];
  const assets: LibraryZipAsset[] = [];
  let skipped = 0;
  let truncated = false;
  let totalBytes = 0;

  const entries = [...entryByNorm.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "zh")
  );

  for (const [path, entry] of entries) {
    if (docs.length + assets.length >= LIBRARY_ZIP_MAX_FILES) {
      truncated = true;
      skipped += 1;
      continue;
    }

    if (isImportableLibraryPath(path)) {
      let text: string;
      try {
        text = await entry.async("string");
      } catch {
        skipped += 1;
        continue;
      }
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > LIBRARY_ZIP_MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      if (totalBytes + bytes > LIBRARY_ZIP_MAX_TOTAL_BYTES) {
        truncated = true;
        skipped += 1;
        continue;
      }
      totalBytes += bytes;
      docs.push({ path: normalizeImportedPath(path), content: text });
      continue;
    }

    if (isImportableImagePath(path)) {
      let blob: Blob;
      try {
        blob = await entry.async("blob");
      } catch {
        skipped += 1;
        continue;
      }
      if (blob.size > LIBRARY_ZIP_MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      if (totalBytes + blob.size > LIBRARY_ZIP_MAX_TOTAL_BYTES) {
        truncated = true;
        skipped += 1;
        continue;
      }
      totalBytes += blob.size;
      assets.push({
        path,
        blob,
        mime: mimeForImportableImage(path, blob.type),
      });
      continue;
    }

    skipped += 1;
  }

  if (!docs.length && !assets.length) {
    return {
      ok: false,
      error: "zip 里没有可导入的 .md / .html / .txt / .svg 或图片",
    };
  }

  return { ok: true, docs, assets, skipped, truncated };
}
