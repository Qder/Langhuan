import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DocMeta, TreeNode } from "./types";

export async function getDefaultLibraryPath(): Promise<string> {
  return invoke("get_default_library_path");
}

export async function openLibrary(path: string): Promise<string> {
  return invoke("open_library", { path });
}

export async function getTree(libraryPath: string): Promise<TreeNode> {
  return invoke("get_tree", { library_path: libraryPath });
}

export async function getDocuments(libraryPath: string): Promise<DocMeta[]> {
  return invoke("get_documents", { library_path: libraryPath });
}

export async function readFile(
  libraryPath: string,
  relativePath: string,
): Promise<string> {
  return invoke("read_file", {
    library_path: libraryPath,
    relative_path: relativePath,
  });
}

export async function writeFile(
  libraryPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  return invoke("write_file", {
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
  return invoke("create_file", {
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
  return invoke("import_from_folder", {
    library_path: libraryPath,
    source_path: sourcePath,
    dest_relative: destRelative,
  });
}

export async function searchLibrary(
  libraryPath: string,
  query: string,
): Promise<DocMeta[]> {
  return invoke("search_library", { library_path: libraryPath, query });
}

export async function pickFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择要导入的文件夹",
  });
  if (selected === null) return null;
  return typeof selected === "string" ? selected : selected[0] ?? null;
}

export async function pickLibraryFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择琅嬛库目录",
  });
  if (selected === null) return null;
  return typeof selected === "string" ? selected : selected[0] ?? null;
}
