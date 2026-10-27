"use client";

import type { AssetMeta, Document, TrashItem } from "../types";

export type LibrarySnapshot = {
  documents: Document[];
  assets: AssetMeta[];
  trash: TrashItem[];
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
    const snap = await tauriInvoke<LibrarySnapshot>("library_scan");
    return { ...snap, ok: true, source: "content" };
  }
  const res = await fetch("/api/library", { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `库列表失败 (${res.status})`);
  }
  return (await res.json()) as LibrarySnapshot;
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
