import type { DocMeta, TreeNode } from "./types";
import * as browser from "./browserBackend";

/** True when running inside a Tauri webview (not plain Chrome). */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return w.__TAURI_INTERNALS__ != null || w.__TAURI__ != null;
}

export function isBrowserMode(): boolean {
  return !isTauriRuntime();
}

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getDefaultLibraryPath(): Promise<string> {
  if (isBrowserMode()) return browser.browserGetDefaultLibraryPath();
  return tauriInvoke("get_default_library_path");
}

export async function openLibrary(path: string): Promise<string> {
  if (isBrowserMode()) return browser.browserOpenLibrary(path);
  return tauriInvoke("open_library", { path });
}

export async function getTree(libraryPath: string): Promise<TreeNode> {
  if (isBrowserMode()) return browser.browserGetTree(libraryPath);
  return tauriInvoke("get_tree", { library_path: libraryPath });
}

export async function getDocuments(libraryPath: string): Promise<DocMeta[]> {
  if (isBrowserMode()) return browser.browserGetDocuments(libraryPath);
  return tauriInvoke("get_documents", { library_path: libraryPath });
}

export async function readFile(
  libraryPath: string,
  relativePath: string,
): Promise<string> {
  if (isBrowserMode()) return browser.browserReadFile(libraryPath, relativePath);
  return tauriInvoke("read_file", {
    library_path: libraryPath,
    relative_path: relativePath,
  });
}

export async function writeFile(
  libraryPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (isBrowserMode()) {
    return browser.browserWriteFile(libraryPath, relativePath, content);
  }
  return tauriInvoke("write_file", {
    library_path: libraryPath,
    relative_path: relativePath,
    content,
  });
}

export async function createFile(
  libraryPath: string,
  relativeDir: string,
  name: string,
  kind: string,
  content?: string,
): Promise<string> {
  if (isBrowserMode()) {
    return browser.browserCreateFile(
      libraryPath,
      relativeDir,
      name,
      kind,
      content,
    );
  }
  return tauriInvoke("create_file", {
    library_path: libraryPath,
    relative_dir: relativeDir,
    name,
    kind,
    content: content ?? null,
  });
}

export async function importFromFolder(
  libraryPath: string,
  sourcePath: string,
  destRelative: string,
): Promise<number> {
  if (isBrowserMode()) {
    return browser.browserImportFromFolder(
      libraryPath,
      sourcePath,
      destRelative,
    );
  }
  return tauriInvoke("import_from_folder", {
    library_path: libraryPath,
    source_path: sourcePath,
    dest_relative: destRelative,
  });
}

export async function searchLibrary(
  libraryPath: string,
  query: string,
): Promise<DocMeta[]> {
  if (isBrowserMode()) return browser.browserSearchLibrary(libraryPath, query);
  return tauriInvoke("search_library", {
    library_path: libraryPath,
    query,
  });
}

export async function pickFolder(): Promise<string | null> {
  if (isBrowserMode()) return browser.browserPickFolder();
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择要导入的文件夹",
  });
  if (selected === null) return null;
  return typeof selected === "string" ? selected : selected[0] ?? null;
}

export async function pickLibraryFolder(): Promise<string | null> {
  if (isBrowserMode()) return browser.browserPickLibraryFolder();
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择琅嬛库目录",
  });
  if (selected === null) return null;
  return typeof selected === "string" ? selected : selected[0] ?? null;
}

export function supportsBrowserFolderPicker(): boolean {
  return browser.supportsDirectoryPicker();
}

export function browserLibraryHint(libraryPath: string): string {
  return browser.browserModeLabel(libraryPath);
}
