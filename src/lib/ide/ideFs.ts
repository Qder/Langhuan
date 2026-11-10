"use client";

import { get, set, del } from "idb-keyval";
import { isFsAccessSupported, ensurePermission } from "@/lib/storage/fsSync";
import { isTauriRuntime } from "@/lib/storage/contentApi";
import { isAndroidWebView, isTauriAndroidRuntime } from "@/lib/platform";
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
  /**
   * `sandbox` = IndexedDB zip import (Android / no folder picker).
   * Default / omitted = File System Access (`handle` set).
   */
  backend?: "fsa" | "sandbox";
};

export type IdeFsCapability = {
  /** Chromium File System Access directory picker (not Android). */
  canPickFolder: boolean;
  /**
   * Zip → IndexedDB sandbox. Works on Android WebView via file input.
   * Primary open path when canPickFolder is false.
   */
  canImportZip: boolean;
  /**
   * Android APK one-shot SAF folder → same IndexedDB sandbox as zip.
   * Never set this by flipping canPickFolder: showDirectoryPicker still NPEs.
   */
  canImportSafFolder: boolean;
  /** canPickFolder || canImportZip || canImportSafFolder */
  canOpenProject: boolean;
  /**
   * When neither open path works (SSR). Otherwise empty — use folderHint for
   * the Android / no-FSA case so UI can still offer zip / SAF import.
   */
  unsupportedHint: string;
  /** Extra copy when folder pick is unavailable but zip / SAF import is. */
  folderHint: string;
};

function isSandboxBackend(session: IdeFolderSession): boolean {
  return (
    session.backend === "sandbox" ||
    (!session.handle && session.id.startsWith("sandbox:"))
  );
}

export type IdeFsCapabilityInput = {
  hasWindow: boolean;
  fsAccess: boolean;
  tauriAndroid: boolean;
  androidWebView: boolean;
  tauriRuntime: boolean;
};

export function ideFsCapabilityFrom(env: IdeFsCapabilityInput): IdeFsCapability {
  if (!env.hasWindow) {
    return {
      canPickFolder: false,
      canImportZip: false,
      canImportSafFolder: false,
      canOpenProject: false,
      unsupportedHint: "服务端渲染中，请在浏览器打开。",
      folderHint: "",
    };
  }
  const canImportZip = true;
  if (env.fsAccess) {
    return {
      canPickFolder: true,
      canImportZip,
      canImportSafFolder: false,
      canOpenProject: true,
      unsupportedHint: "",
      folderHint: "",
    };
  }
  if (env.tauriAndroid) {
    // 只用 SafPlugin 的 ACTION_OPEN_DOCUMENT_TREE，绝不调用 showDirectoryPicker。
    return {
      canPickFolder: false,
      canImportZip,
      canImportSafFolder: true,
      canOpenProject: true,
      unsupportedHint: "",
      folderHint:
        "可「选择文件夹」导入到应用沙箱（与 zip 相同的忽略规则和上限）。编辑保存在沙箱，不会自动写回原文件夹，也不会写入笔记库 content/。也可继续导入 zip。",
    };
  }
  if (env.androidWebView) {
    return {
      canPickFolder: false,
      canImportZip,
      canImportSafFolder: false,
      canOpenProject: true,
      unsupportedHint: "",
      folderHint:
        "当前是浏览器，不能选择整文件夹。请用琅嬛 Android 应用的「选择文件夹」，或把工程打成 zip 导入。导入落在应用沙箱，不会写入笔记库 content/。",
    };
  }
  if (env.tauriRuntime) {
    return {
      canPickFolder: false,
      canImportZip,
      canImportSafFolder: false,
      canOpenProject: true,
      unsupportedHint: "",
      folderHint:
        "当前桌面 WebView 未提供目录选择 API。可「导入工程 zip」，或用 Chrome / Edge 打开文件夹。",
    };
  }
  return {
    canPickFolder: false,
    canImportZip,
    canImportSafFolder: false,
    canOpenProject: true,
    unsupportedHint: "",
    folderHint:
      "当前环境不能选择文件夹。可「导入工程 zip」，或换用支持目录选择的 Chrome / Edge。",
  };
}

export function getIdeFsCapability(): IdeFsCapability {
  return ideFsCapabilityFrom({
    hasWindow: typeof window !== "undefined",
    fsAccess: isFsAccessSupported(),
    tauriAndroid: isTauriAndroidRuntime(),
    androidWebView: isAndroidWebView(),
    tauriRuntime: isTauriRuntime(),
  });
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
      backend: "fsa",
    };
  } catch {
    // user cancelled or denied
    return null;
  }
}

/** Re-open a recent project by restoring its directory handle (FSA only). */
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
    backend: "fsa",
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
  if (isSandboxBackend(session)) {
    const { loadSandboxProject, listSandboxDir } = await import("./sandboxFs");
    const project = await loadSandboxProject(session.id);
    if (!project) throw new Error("沙箱工程已丢失，请重新选择文件夹或导入 zip");
    return listSandboxDir(project, relDir);
  }
  if (!session.handle) throw new Error("无目录句柄");
  const dir = relDir ? await resolveDir(session.handle, relDir) : session.handle;
  const entries: IdeFsEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (shouldIgnoreName(name)) continue;
    const path = relDir
      ? `${relDir.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`
      : name;
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
  if (isSandboxBackend(session)) {
    const { loadSandboxProject, readSandboxFile } = await import("./sandboxFs");
    const project = await loadSandboxProject(session.id);
    if (!project) throw new Error("沙箱工程已丢失，请重新选择文件夹或导入 zip");
    return readSandboxFile(project, relPath);
  }
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
  if (isSandboxBackend(session)) {
    const { loadSandboxProject, writeSandboxFile } = await import("./sandboxFs");
    const project = await loadSandboxProject(session.id);
    if (!project) throw new Error("沙箱工程已丢失，请重新选择文件夹或导入 zip");
    await writeSandboxFile(project, relPath, content);
    return;
  }
  if (!session.handle) throw new Error("无目录句柄");
  const fh = await resolveFile(session.handle, relPath);
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

export { isLikelyTextPath } from "./textPath";
