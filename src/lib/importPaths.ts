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

/**
 * Rewrite import paths under a target folder.
 * - targetFolder empty → keep as-is (库根目录)
 * - preserve relative structure when paths already have dirs
 * - flat files (basename only) land as targetFolder/basename
 */
export function rewriteImportPaths(
  files: { path: string; content: string }[],
  targetFolder?: string
): { path: string; content: string }[] {
  const folder = (targetFolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) {
    return files.map((f) => ({
      ...f,
      path: f.path.replace(/\\/g, "/").replace(/^\/+/, ""),
    }));
  }
  return files.map((f) => {
    let rel = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
    // If user picked a directory, webkitRelativePath often starts with the root folder name.
    // Keep the relative tree under the chosen target.
    const joined = `${folder}/${rel}`.replace(/\/+/g, "/");
    return { path: joined, content: f.content };
  });
}

export function importPreviewLabel(files: { path: string }[]): string {
  const n = files.length;
  if (n === 0) return "没有可导入的文件";
  if (n === 1) return `将导入 ${basename(files[0].path)}`;
  return `将导入 ${n} 个文件`;
}
