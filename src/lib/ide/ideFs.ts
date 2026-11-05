"use client";

import { get, set, del } from "idb-keyval";
import { isFsAccessSupported, ensurePermission } from "@/lib/storage/fsSync";
import { isTauriRuntime } from "@/lib/storage/contentApi";
import { isAndroidWebView } from "@/lib/platform";
import { shouldIgnoreName } from "./ignore";

export const IDE_HANDLE_KEY_PREFIX = "langhuan-ide-handle:";

export type IdeFsEntry = {
  name: string;
  /** Project-relative path using `/`. */
  path: string;
  kind: "file" | "directory";
};

export type IdeFolderSession = {
  id: string;
  name: string;
  pathLabel: string;
  /** Browser / WebView2 directory handle when using File System Access. */
  handle: FileSystemDirectoryHandle | null;
  /** Absolute root path when using a future Tauri path backend. */
  absRoot: string | null;
};

export type IdeFsCapability = {
  canPickFolder: boolean;
  /** Human hint when canPickFolder is false. */
  unsupportedHint: string;
};

export function getIdeFsCapability(): IdeFsCapability {
  if (typeof window === "undefined") {
    return {
      canPickFolder: false,
      unsupportedHint: "服务端渲染中，请在浏览器打开。",
    };
  }
  if (isFsAccessSupported()) {
    return { canPickFolder: true, unsupportedHint: "" };
  }
  if (isAndroidWebView()) {
    // Android WebView 名义上有 showDirectoryPicker，但真调用会让 Tauri 的
    // showFilePicker 在 intent.type 为 null 时 NPE，进程被杀。诚实说明，
    // 不要假装能打开工程。
    return {
      canPickFolder: false,
      unsupportedHint:
        "安卓版不能读取设备上的工程目录（系统文件选择器不支持整目录授权）。读码工作台留给桌面 / Chrome。",
    };
  }
  if (isTauriRuntime()) {
    // v1: Tauri webviews without FSA still need plugin-fs; don't pretend.
    return {
      canPickFolder: false,
      unsupportedHint:
        "当前桌面 WebView 未提供目录选择 API。请用 Chrome / Edge 打开，或等待后续桌面文件插件。",
    };
  }
  return {
    canPickFolder: false,
    unsupportedHint: "用桌面版打开工程（或使用支持「选择文件夹」的 Chrome / Edge）。",
  };
}

function handleKey(id: string): string {
  return `${IDE_HANDLE_KEY_PREFIX}${id}`;
}

export async function storeIdeHandle(
  id: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  await set(handleKey(id), handle);
}

export async function loadIdeHandle(
  id: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await get<FileSystemDirectoryHandle>(handleKey(id));
    return h ?? null;
  } catch {
    return null;
  }
}

export async function clearIdeHandle(id: string): Promise<void> {
  try {
    await del(handleKey(id));
  } catch {
    /* ignore */
  }
}

/** Pick a project root folder (File System Access). */
export async function pickIdeFolder(): Promise<IdeFolderSession | null> {
  const cap = getIdeFsCapability();
  if (!cap.canPickFolder || !isFsAccessSupported()) return null;
  try {
    const handle = await window.showDirectoryPicker!({
      id: "langhuan-ide-project",
      mode: "readwrite",
    });
    const ok = await ensurePermission(handle, "readwrite");
    if (!ok) return null;
    const id = `fsa:${handle.name}`;
    await storeIdeHandle(id, handle);
    return {
      id,
      name: handle.name,
      pathLabel: handle.name,
      handle,
      absRoot: null,
    };
  } catch {
    // user cancelled or denied
    return null;
  }
}

/** Re-open a recent project by restoring its directory handle. */
export async function reopenIdeFolder(
  id: string,
  meta: { name: string; pathLabel: string }
): Promise<IdeFolderSession | null> {
  const handle = await loadIdeHandle(id);
  if (!handle) return null;
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) return null;
  return {
    id,
    name: meta.name || handle.name,
    pathLabel: meta.pathLabel || handle.name,
    handle,
    absRoot: null,
  };
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  relDir: string
): Promise<FileSystemDirectoryHandle> {
  const parts = relDir.replace(/\\/g, "/").split("/").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part);
  }
  return cur;
}

async function resolveFile(
  root: FileSystemDirectoryHandle,
  relPath: string
): Promise<FileSystemFileHandle> {
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("空路径");
  const fileName = parts.pop()!;
  let cur = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part);
  }
  return cur.getFileHandle(fileName);
}

export async function listIdeDir(
  session: IdeFolderSession,
  relDir: string = ""
): Promise<IdeFsEntry[]> {
  if (!session.handle) throw new Error("无目录句柄");
  const dir = relDir ? await resolveDir(session.handle, relDir) : session.handle;
  const entries: IdeFsEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (shouldIgnoreName(name)) continue;
    const path = relDir ? `${relDir.replace(/\\/g, "/").replace(/\/$/, "")}/${name}` : name;
    entries.push({
      name,
      path,
      kind: handle.kind === "directory" ? "directory" : "file",
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return entries;
}

export async function readIdeFile(
  session: IdeFolderSession,
  relPath: string
): Promise<string> {
  if (!session.handle) throw new Error("无目录句柄");
  const fh = await resolveFile(session.handle, relPath);
  const file = await fh.getFile();
  return file.text();
}

export async function writeIdeFile(
  session: IdeFolderSession,
  relPath: string,
  content: string
): Promise<void> {
  if (!session.handle) throw new Error("无目录句柄");
  const fh = await resolveFile(session.handle, relPath);
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Heuristic: skip huge / binary-looking files in the editor. */
export function isLikelyTextPath(path: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop() || "";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const textExts = new Set([
    "java",
    "cpp",
    "cc",
    "cxx",
    "c",
    "h",
    "hpp",
    "hh",
    "hxx",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "json",
    "md",
    "markdown",
    "mdx",
    "html",
    "htm",
    "css",
    "scss",
    "less",
    "xml",
    "xsl",
    "svg",
    "py",
    "rs",
    "go",
    "txt",
    "toml",
    "yaml",
    "yml",
    "ini",
    "cfg",
    "properties",
    "gradle",
    "kt",
    "kts",
    "sql",
    "sh",
    "bash",
    "zsh",
    "env",
    "gitignore",
    "dockerignore",
    "editorconfig",
    "xml",
    "pom",
  ]);
  if (!ext) return base.startsWith(".") || base === "Makefile" || base === "Dockerfile";
  return textExts.has(ext) || base === "pom.xml";
}
