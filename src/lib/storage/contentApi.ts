"use client";

import type { AssetMeta, Document, TrashItem } from "../types";
import type { ProjectMeta } from "../project";
import { mimeForAssetPath } from "../projectAssets";
import type { CssFileIndex } from "../locate/cssLocate";
import type { JsFileIndex } from "../locate/jsIndex";
import {
  emptyQuizStore,
  normalizeQuizStore,
  type QuizStoreFile,
} from "../quiz";
import { FS_INDEX_DIR, FS_QUIZ_FILE } from "./constants";

export type LibrarySnapshot = {
  documents: Document[];
  assets: AssetMeta[];
  trash: TrashItem[];
  /** 项目元数据（content/<root>/.langhuan/project.json） */
  projects: ProjectMeta[];
  /** 内联用的项目文本缓存：root → 项目内相对路径 → 内容 */
  projectTexts: Record<string, Record<string, string>>;
  /** CSS 索引（选择器 → 文件行号） */
  cssIndexes: CssFileIndex[];
  /** JS 符号索引（函数 / DOM 查询 / 事件绑定 → 文件行号） */
  jsIndexes: JsFileIndex[];
  ok: boolean;
  source: "content";
};

/** Detect Tauri 2 webview (do not throw if API package missing in browser). */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Sync URL for browser <img src>. Prefer resolveLibraryFileUrl in Tauri. */
export function libraryFileUrl(path: string): string {
  return `/api/library/file?path=${encodeURIComponent(path)}`;
}

/** 读到的二进制资源（base64 不含 data: 前缀）。 */
export type FetchedAsset = { mime: string; base64: string; bytes: number };

/**
 * 读库内一个二进制文件（项目里的图片 / 字体）。
 *
 * 超过 `maxBytes` 时不读 body，直接回 "too-large" —— 预览不内联它，但要能说清为什么。
 * 文件不存在回 null。
 */
export async function fetchProjectAsset(
  path: string,
  opts?: { maxBytes?: number }
): Promise<FetchedAsset | "too-large" | null> {
  if (isTauriRuntime()) {
    try {
      const file = await tauriInvoke<{ base64: string; mime: string }>("library_read_file", {
        path,
      });
      const bytes = Math.floor((file.base64.length * 3) / 4);
      if (opts?.maxBytes && bytes > opts.maxBytes) return "too-large";
      return { mime: mimeForAssetPath(path) || file.mime, base64: file.base64, bytes };
    } catch {
      return null;
    }
  }
  const res = await fetch(libraryFileUrl(path), { cache: "no-store" });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") || "");
  if (opts?.maxBytes && Number.isFinite(declared) && declared > opts.maxBytes) {
    return "too-large";
  }
  const blob = await res.blob();
  if (opts?.maxBytes && blob.size > opts.maxBytes) return "too-large";
  const base64 = await blobToBase64(blob);
  // 扩展名说了算：服务端对字体可能只给 application/octet-stream
  return { mime: mimeForAssetPath(path) || blob.type || "application/octet-stream", base64, bytes: blob.size };
}

/** Browser: API URL. Tauri: data: URL from Rust base64. */
export async function resolveLibraryFileUrl(path: string): Promise<string> {
  if (!isTauriRuntime()) return libraryFileUrl(path);
  const file = await tauriInvoke<{ base64: string; mime: string; path: string }>(
    "library_read_file",
    { path }
  );
  return `data:${file.mime};base64,${file.base64}`;
}

export async function fetchLibrary(): Promise<LibrarySnapshot> {
  if (isTauriRuntime()) {
    const snap = await tauriInvoke<
      Omit<LibrarySnapshot, "projects" | "projectTexts" | "cssIndexes" | "jsIndexes">
    >("library_scan");
    // 桌面版暂不扫描项目（Rust 侧未实现）——项目导入在浏览器版可用
    return {
      ...snap,
      ok: true,
      source: "content",
      projects: [],
      projectTexts: {},
      cssIndexes: [],
      jsIndexes: [],
    };
  }
  const res = await fetch("/api/library", { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `库列表失败 (${res.status})`);
  }
  const data = (await res.json()) as LibrarySnapshot;
  return {
    ...data,
    projects: Array.isArray(data.projects) ? data.projects : [],
    projectTexts: data.projectTexts || {},
    cssIndexes: Array.isArray(data.cssIndexes) ? data.cssIndexes : [],
    jsIndexes: Array.isArray(data.jsIndexes) ? data.jsIndexes : [],
  };
}

export async function putLibraryDoc(doc: Document, previousPath?: string): Promise<Document> {
  if (isTauriRuntime()) {
    return tauriInvoke<Document>("library_put_doc", {
      args: {
        path: doc.path,
        content: doc.content,
        id: doc.id,
        starred: doc.starred,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        previousPath,
      },
    });
  }
  const res = await fetch("/api/library/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: doc.path,
      content: doc.content,
      id: doc.id,
      starred: doc.starred,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      previousPath,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `写入失败 (${res.status})`);
  }
  const data = (await res.json()) as { document: Document };
  return data.document;
}

/**
 * 原样写一个项目资源文件（css/js/图片…）：保留目录结构，但不进正文索引。
 * 项目元数据 `<root>/.langhuan/project.json` 也走这里。
 */
export async function putLibraryRawFile(input: {
  path: string;
  content?: string;
  base64?: string;
}): Promise<string> {
  if (isTauriRuntime()) {
    throw new Error("桌面版暂不支持项目导入，请在浏览器中使用");
  }
  const res = await fetch("/api/library/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: input.path,
      content: input.content,
      base64: input.base64,
      raw: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `写入失败 (${res.status})`);
  }
  const data = (await res.json()) as { path?: string };
  return data.path || input.path;
}

/**
 * 建/刷新一个 CSS 文件的索引（服务端用 postcss 解析源文件并落盘）。
 * 返回 null 表示不可用（桌面版 / 文件不存在 / 服务端拒绝）。
 */
export async function buildLibraryCssIndex(file: string): Promise<CssFileIndex | null> {
  if (isTauriRuntime()) return null;
  try {
    const res = await fetch("/api/library/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cssIndex: true, file }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { index?: CssFileIndex };
    return data.index && data.index.file ? data.index : null;
  } catch {
    return null;
  }
}

/**
 * 建/刷新一个 .js 文件的符号索引（服务端用 acorn 解析并落盘）。
 * 返回 null 表示不可用（桌面版 / 文件不存在 / 服务端拒绝）。
 */
export async function buildLibraryJsIndex(file: string): Promise<JsFileIndex | null> {
  if (isTauriRuntime()) return null;
  try {
    const res = await fetch("/api/library/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsIndex: true, file }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { index?: JsFileIndex };
    return data.index && data.index.file ? data.index : null;
  } catch {
    return null;
  }
}

export async function deleteLibraryDoc(
  path: string,
  mode: "trash" | "hard" = "trash"
): Promise<void> {
  if (isTauriRuntime()) {
    await tauriInvoke("library_delete_path", { path, mode });
    return;
  }
  const q = new URLSearchParams({ path, mode });
  const res = await fetch(`/api/library/file?${q}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `删除失败 (${res.status})`);
  }
}

export async function putLibraryAsset(input: {
  path: string;
  base64: string;
  mime: string;
  id?: string;
  docId?: string;
  createdAt?: number;
}): Promise<AssetMeta> {
  if (isTauriRuntime()) {
    return tauriInvoke<AssetMeta>("library_put_asset", {
      args: {
        path: input.path,
        base64: input.base64,
        mime: input.mime,
        id: input.id,
        docId: input.docId,
        createdAt: input.createdAt,
      },
    });
  }
  const res = await fetch("/api/library/asset", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `附件写入失败 (${res.status})`);
  }
  const data = (await res.json()) as { asset: AssetMeta };
  return data.asset;
}

export async function deleteLibraryAsset(path: string): Promise<void> {
  if (isTauriRuntime()) {
    await tauriInvoke("library_delete_path", { path, mode: "hard" });
    return;
  }
  const q = new URLSearchParams({ path, mode: "hard" });
  const res = await fetch(`/api/library/file?${q}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `附件删除失败 (${res.status})`);
  }
}

export async function restoreLibraryTrash(id: string): Promise<Document> {
  if (isTauriRuntime()) {
    return tauriInvoke<Document>("library_trash_restore", { id });
  }
  const res = await fetch("/api/library/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `恢复失败 (${res.status})`);
  }
  const data = (await res.json()) as { document: Document };
  return data.document;
}

export async function purgeLibraryTrash(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await tauriInvoke("library_trash_purge", { id });
    return;
  }
  const res = await fetch("/api/library/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "purge", id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `彻底删除失败 (${res.status})`);
  }
}

export async function bulkWriteLibrary(payload: {
  documents: Document[];
  assets?: Array<AssetMeta & { base64?: string }>;
  trash?: TrashItem[];
  seed?: boolean;
}): Promise<LibrarySnapshot> {
  if (isTauriRuntime()) {
    const snap = await tauriInvoke<LibrarySnapshot>("library_bulk", {
      args: {
        documents: payload.documents,
        assets: payload.assets,
        trash: payload.trash,
      },
    });
    return { ...snap, ok: true, source: "content" };
  }
  const res = await fetch("/api/library/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `批量写入失败 (${res.status})`);
  }
  return (await res.json()) as LibrarySnapshot;
}

export async function ensureContentFolder(relDir: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await tauriInvoke("library_mkdir", { path: relDir });
    } catch {
      /* best-effort */
    }
    return;
  }
  const res = await fetch("/api/library/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mkdirOnly: relDir }),
  });
  if (!res.ok) {
    /* best-effort */
  }
}

/** Convert Blob → base64 (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const QUIZ_REL = `${FS_INDEX_DIR}/${FS_QUIZ_FILE}`;

/** Load content/.langhuan/quiz.json via existing file API (no new endpoint). */
export async function fetchQuizStore(): Promise<QuizStoreFile> {
  if (isTauriRuntime()) {
    try {
      const file = await tauriInvoke<{ base64: string }>("library_read_file", {
        path: QUIZ_REL,
      });
      const json = atob(file.base64);
      return normalizeQuizStore(JSON.parse(json));
    } catch {
      return emptyQuizStore();
    }
  }
  const res = await fetch(`/api/library/file?path=${encodeURIComponent(QUIZ_REL)}`, {
    cache: "no-store",
  });
  if (!res.ok) return emptyQuizStore();
  try {
    const text = await res.text();
    return normalizeQuizStore(JSON.parse(text));
  } catch {
    return emptyQuizStore();
  }
}

/** Persist quiz metadata to content/.langhuan/quiz.json via file PUT. */
export async function putQuizStore(store: QuizStoreFile): Promise<void> {
  const payload: QuizStoreFile = {
    format: "langhuan-quiz",
    version: 1,
    updatedAt: store.updatedAt || Date.now(),
    docs: store.docs || [],
  };
  const content = JSON.stringify(payload, null, 2) + "\n";
  if (isTauriRuntime()) {
    try {
      await tauriInvoke("library_put_doc", {
        args: {
          path: QUIZ_REL,
          content,
          id: "meta_quiz",
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    } catch {
      /* best-effort */
    }
    return;
  }
  const res = await fetch("/api/library/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: QUIZ_REL, content }),
  });
  if (!res.ok) {
    /* best-effort — IDB still holds quizDocs */
  }
}

