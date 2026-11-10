/** One-shot SAF library payload → the existing content/ import dialog.
 * No store writes, IDE sandbox, sync binding or source directory handles here.
 */
import { pickAndScanSafLibrary, type SafLibraryScan } from "./android/saf";
import {
  LIBRARY_ZIP_MAX_FILES, LIBRARY_ZIP_MAX_FILE_BYTES, LIBRARY_ZIP_MAX_TOTAL_BYTES,
  normalizeLibraryZipPath, type LibraryZipDoc, type LibraryZipAsset,
} from "./importLibraryZip";
import { isImportableLibraryPath, isImportableImagePath, normalizeImportedPath, mimeForImportableImage } from "./importable";

export type LibraryFolderImport = {
  docs: LibraryZipDoc[];
  assets: LibraryZipAsset[];
  details: string[];
};

export function libraryFolderScanToImport(raw: SafLibraryScan): LibraryFolderImport {
  const docs: LibraryZipDoc[] = [];
  const assets: LibraryZipAsset[] = [];
  const skipped = raw.skipped.map((s) => `${s.path}：${s.reason}`);
  let truncated = raw.truncated;
  let total = 0;
  const seen = new Set<string>();
  const entries = [
    ...raw.docs.map((item) => ({ ...item, kind: "doc" as const })),
    ...raw.assets.map((item) => ({ ...item, kind: "asset" as const })),
  ].sort((a, b) => a.path.localeCompare(b.path, "zh"));
  for (const item of entries) {
    const path = normalizeLibraryZipPath(item.path);
    let reason = "";
    let blob: Blob | undefined;
    let bytes = 0;
    if (!path) reason = "忽略目录或文件规则";
    else if (seen.has(normalizeImportedPath(path))) reason = "重复导入路径";
    else if (item.kind === "doc" ? !isImportableLibraryPath(path) : !isImportableImagePath(path)) reason = "不支持的笔记或图片类型";
    else if (docs.length + assets.length >= LIBRARY_ZIP_MAX_FILES) {
      truncated = true;
      reason = "超过 2000 文件上限";
    } else if (item.kind === "doc") {
      bytes = new TextEncoder().encode(item.content).byteLength;
    } else {
      // Avoid allocating a huge decoded payload even if a bridge response is bad.
      if (item.base64.length > Math.ceil(LIBRARY_ZIP_MAX_FILE_BYTES / 3) * 4) reason = "单文件超过 8 MiB";
      else {
        try {
          const binary = atob(item.base64);
          const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          bytes = data.byteLength;
          blob = new Blob([data], { type: mimeForImportableImage(path) });
        } catch {
          reason = "图片数据无效";
        }
      }
    }
    if (!reason && bytes > LIBRARY_ZIP_MAX_FILE_BYTES) reason = "单文件超过 8 MiB";
    if (!reason && total + bytes > LIBRARY_ZIP_MAX_TOTAL_BYTES) {
      truncated = true;
      reason = "合计超过 64 MiB";
    }
    if (reason || !path) {
      skipped.push(`${item.path}：${reason}`);
      continue;
    }
    seen.add(normalizeImportedPath(path));
    total += bytes;
    if (item.kind === "doc") docs.push({ path: normalizeImportedPath(path), content: item.content });
    else if (blob) assets.push({ path, blob, mime: mimeForImportableImage(path) });
  }
  const details = [
    `文件夹扫描：${docs.length} 篇笔记、${assets.length} 张图片。确认后只拷入书库，不绑定或写回原文件夹。`,
    ...(truncated ? ["已截断超限内容（2000 文件 / 单文件 8 MiB / 合计 64 MiB）。"] : []),
    ...(skipped.length ? [`跳过 ${skipped.length} 项：`, ...skipped] : []),
  ];
  return { docs, assets, details };
}

export async function pickLibraryFolderImport(): Promise<LibraryFolderImport | null> {
  const raw = await pickAndScanSafLibrary();
  if (!raw) return null;
  const result = libraryFolderScanToImport(raw);
  if (!result.docs.length && !result.assets.length) {
    throw new Error(["文件夹里没有可导入的 .md / .html / .txt / .svg 或图片", ...result.details].join("\n"));
  }
  return result;
}
