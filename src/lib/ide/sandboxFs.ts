/**
 * Android / 无目录选择时的读码工程沙箱。
 *
 * 系统 WebView 不能整目录授权（showDirectoryPicker 会 NPE），所以把课件工程
 * 打成 zip → 解压进 IndexedDB → 当作工程根浏览。不写 content/，不写磁盘工程源。
 */
import { get, set, del } from "idb-keyval";
import JSZip from "jszip";
import { shouldIgnoreName } from "./ignore";
import type { IdeFsEntry, IdeFolderSession } from "./ideFs";
import { isLikelyTextPath } from "./textPath";

export const IDE_SANDBOX_KEY_PREFIX = "langhuan-ide-sandbox:";
export const IDE_SANDBOX_ID_PREFIX = "sandbox:";

/** Soft caps so a huge zip cannot blow IndexedDB / 卡死 WebView. */
export const IDE_SANDBOX_MAX_FILES = 3000;
export const IDE_SANDBOX_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const IDE_SANDBOX_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export type IdeSandboxProject = {
  id: string;
  name: string;
  pathLabel: string;
  sourceName: string;
  importedAt: number;
  /** Project-relative path → UTF-8 text. Directories are implied by paths. */
  files: Record<string, string>;
};

export type IdeSandboxImportResult =
  | { ok: true; project: IdeSandboxProject; skipped: number; truncated: boolean }
  | { ok: false; error: string };

function sandboxKey(id: string): string {
  return `${IDE_SANDBOX_KEY_PREFIX}${id}`;
}

export function isSandboxSessionId(id: string): boolean {
  return id.startsWith(IDE_SANDBOX_ID_PREFIX);
}

export function isSandboxSession(session: IdeFolderSession): boolean {
  return session.backend === "sandbox" || isSandboxSessionId(session.id);
}

export async function loadSandboxProject(
  id: string
): Promise<IdeSandboxProject | null> {
  try {
    const p = await get<IdeSandboxProject>(sandboxKey(id));
    if (!p || typeof p !== "object" || !p.files) return null;
    return p;
  } catch {
    return null;
  }
}

export async function storeSandboxProject(project: IdeSandboxProject): Promise<void> {
  await set(sandboxKey(project.id), project);
}

export async function clearSandboxProject(id: string): Promise<void> {
  try {
    await del(sandboxKey(id));
  } catch {
    /* ignore */
  }
}

/** Normalize zip entry path; drop traversal / junk. */
export function normalizeZipEntryPath(raw: string): string | null {
  const p = String(raw || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return null;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((seg) => seg === ".." || seg === ".")) return null;
  if (parts.some((seg) => shouldIgnoreName(seg))) return null;
  return parts.join("/");
}

/**
 * If every file sits under one top-level folder (common coursework zip), strip it
 * so the explorer root is the project itself, not "campus-food/…".
 */
export function stripSingleRootPrefix(paths: string[]): {
  paths: string[];
  rootName: string | null;
} {
  const cleaned = paths.filter(Boolean);
  if (cleaned.length === 0) return { paths: cleaned, rootName: null };
  const first = cleaned[0].split("/")[0];
  if (!first) return { paths: cleaned, rootName: null };
  const allUnder = cleaned.every((p) => p === first || p.startsWith(`${first}/`));
  if (!allUnder) return { paths: cleaned, rootName: null };
  // Need at least one nested path — a single file at root is fine as-is.
  const hasNested = cleaned.some((p) => p.startsWith(`${first}/`));
  if (!hasNested) return { paths: cleaned, rootName: null };
  return {
    rootName: first,
    paths: cleaned.map((p) =>
      p === first ? "" : p.slice(first.length + 1)
    ).filter(Boolean),
  };
}

function looksBinaryText(text: string): boolean {
  // NUL in the first chunk → almost certainly binary.
  const sample = text.slice(0, 8192);
  return sample.includes("\u0000");
}

function projectNameFromZip(fileName: string, rootName: string | null): string {
  const base = fileName.replace(/\.zip$/i, "").trim() || "工程";
  if (rootName && rootName !== "__MACOSX") return rootName;
  return base;
}

export async function importZipToSandbox(
  zipData: ArrayBuffer | Blob | Uint8Array,
  sourceName: string
): Promise<IdeSandboxImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch {
    return { ok: false, error: "打不开这个 zip（文件损坏或不是 zip）" };
  }

  const rawPaths: string[] = [];
  const entryByNorm = new Map<string, JSZip.JSZipObject>();
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const norm = normalizeZipEntryPath(relativePath);
    if (!norm) return;
    rawPaths.push(norm);
    entryByNorm.set(norm, entry);
  });

  if (rawPaths.length === 0) {
    return { ok: false, error: "zip 里没有可用的文件（或全被忽略规则过滤了）" };
  }

  const { rootName } = stripSingleRootPrefix(rawPaths);
  // Remap entries after strip
  const remapped = new Map<string, JSZip.JSZipObject>();
  for (const [oldPath, entry] of entryByNorm) {
    let next = oldPath;
    if (rootName) {
      if (oldPath === rootName) continue;
      if (!oldPath.startsWith(`${rootName}/`)) continue;
      next = oldPath.slice(rootName.length + 1);
    }
    if (!next) continue;
    remapped.set(next, entry);
  }

  const files: Record<string, string> = {};
  let totalBytes = 0;
  let skipped = 0;
  let truncated = false;

  const ordered = [...remapped.keys()].sort((a, b) => a.localeCompare(b, "zh"));
  for (const path of ordered) {
    if (Object.keys(files).length >= IDE_SANDBOX_MAX_FILES) {
      truncated = true;
      break;
    }
    if (!isLikelyTextPath(path)) {
      skipped += 1;
      continue;
    }
    const entry = remapped.get(path);
    if (!entry) continue;
    let text: string;
    try {
      text = await entry.async("string");
    } catch {
      skipped += 1;
      continue;
    }
    if (looksBinaryText(text)) {
      skipped += 1;
      continue;
    }
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > IDE_SANDBOX_MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    if (totalBytes + bytes > IDE_SANDBOX_MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    files[path] = text;
    totalBytes += bytes;
  }

  if (Object.keys(files).length === 0) {
    return {
      ok: false,
      error: truncated
        ? "工程太大，未能导入任何文本文件（可先去掉 node_modules / build 再打包）"
        : "zip 里没有可预览的文本源码（已跳过二进制与忽略目录）",
    };
  }

  const name = projectNameFromZip(sourceName, rootName);
  const id = `${IDE_SANDBOX_ID_PREFIX}${name}-${Date.now().toString(36)}`;
  const project: IdeSandboxProject = {
    id,
    name,
    pathLabel: `已导入 · ${sourceName || name}`,
    sourceName: sourceName || `${name}.zip`,
    importedAt: Date.now(),
    files,
  };
  await storeSandboxProject(project);
  return { ok: true, project, skipped, truncated };
}

export function sessionFromSandbox(project: IdeSandboxProject): IdeFolderSession {
  return {
    id: project.id,
    name: project.name,
    pathLabel: project.pathLabel,
    handle: null,
    absRoot: null,
    backend: "sandbox",
  };
}

export function listSandboxDir(
  project: IdeSandboxProject,
  relDir: string = ""
): IdeFsEntry[] {
  const prefix = relDir
    ? `${relDir.replace(/\\/g, "/").replace(/\/$/, "")}/`
    : "";
  const names = new Map<string, IdeFsEntry>();

  for (const filePath of Object.keys(project.files)) {
    if (prefix && !filePath.startsWith(prefix)) continue;
    if (!prefix && filePath.includes("/") === false) {
      // file at root
      const name = filePath;
      if (shouldIgnoreName(name)) continue;
      names.set(name, { name, path: name, kind: "file" });
      continue;
    }
    const rest = prefix ? filePath.slice(prefix.length) : filePath;
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash < 0) {
      if (shouldIgnoreName(rest)) continue;
      names.set(rest, {
        name: rest,
        path: prefix ? `${prefix.slice(0, -1)}/${rest}` : rest,
        kind: "file",
      });
    } else {
      const name = rest.slice(0, slash);
      if (shouldIgnoreName(name)) continue;
      const path = prefix ? `${prefix.slice(0, -1)}/${name}` : name;
      if (!names.has(name) || names.get(name)!.kind !== "directory") {
        names.set(name, { name, path, kind: "directory" });
      }
    }
  }

  const entries = [...names.values()];
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return entries;
}

export function readSandboxFile(
  project: IdeSandboxProject,
  relPath: string
): string {
  const norm = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const body = project.files[norm];
  if (body == null) throw new Error(`找不到文件：${norm}`);
  return body;
}

export async function writeSandboxFile(
  project: IdeSandboxProject,
  relPath: string,
  content: string
): Promise<IdeSandboxProject> {
  const norm = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!(norm in project.files)) throw new Error(`找不到文件：${norm}`);
  const next: IdeSandboxProject = {
    ...project,
    files: { ...project.files, [norm]: content },
  };
  await storeSandboxProject(next);
  return next;
}
