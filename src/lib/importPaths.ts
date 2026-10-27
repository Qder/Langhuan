import { basename, dirname } from "@/lib/utils";

/** Unique folder prefixes from document paths (excluding empty root). */
export function collectFolders(paths: string[]): string[] {
  const set = new Set<string>();
  for (const raw of paths) {
    const p = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    let d = dirname(p);
    while (d) {
      set.add(d);
      d = dirname(d);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
}

/** Normalize vault-relative path and optionally prefix with target folder. */
export function rewriteImportPath(path: string, targetFolder?: string): string {
  const folder = (targetFolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const rel = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!folder) return rel;
  // If user picked a directory, webkitRelativePath often starts with the root folder name.
  // Keep the relative tree under the chosen target.
  return `${folder}/${rel}`.replace(/\/+/g, "/");
}

/**
 * Rewrite import paths under a target folder.
 * - targetFolder empty → keep as-is (库根目录)
 * - preserve relative structure when paths already have dirs
 * - flat files (basename only) land as targetFolder/basename
 *
 * Works for docs `{ path; content }` and assets `{ path; blob; … }`.
 */
export function rewriteImportPaths<T extends { path: string }>(
  files: T[],
  targetFolder?: string
): T[] {
  return files.map((f) => ({
    ...f,
    path: rewriteImportPath(f.path, targetFolder),
  }));
}

export function importPreviewLabel(
  files: { path: string }[],
  assetCount = 0
): string {
  const n = files.length;
  if (n === 0 && assetCount === 0) return "没有可导入的文件";
  if (n === 0) return `将导入 ${assetCount} 张图片`;
  if (assetCount > 0) {
    if (n === 1) return `将导入 ${basename(files[0].path)} 及 ${assetCount} 张图片`;
    return `将导入 ${n} 个文档、${assetCount} 张图片`;
  }
  if (n === 1) return `将导入 ${basename(files[0].path)}`;
  return `将导入 ${n} 个文件`;
}

/** Status line after a batch import of docs and/or images. */
export function formatImportStatus(docCount: number, imageCount: number): string {
  if (!docCount && !imageCount) return "没有可导入的文件";
  if (docCount && imageCount) return `已导入 ${docCount} 篇文档、${imageCount} 张图片`;
  if (docCount) return `已导入 ${docCount} 篇文档`;
  return `已导入 ${imageCount} 张图片`;
}
