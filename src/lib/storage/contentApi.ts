"use client";

import type { AssetMeta, Document, TrashItem } from "../types";

export type LibrarySnapshot = {
  documents: Document[];
  assets: AssetMeta[];
  trash: TrashItem[];
  ok: boolean;
  source: "content";
};

export function libraryFileUrl(path: string): string {
  return `/api/library/file?path=${encodeURIComponent(path)}`;
}

export async function fetchLibrary(): Promise<LibrarySnapshot> {
  const res = await fetch("/api/library", { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `库列表失败 (${res.status})`);
  }
  return (await res.json()) as LibrarySnapshot;
}

export async function putLibraryDoc(doc: Document, previousPath?: string): Promise<Document> {
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
  const q = new URLSearchParams({ path, mode: "hard" });
  const res = await fetch(`/api/library/file?${q}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `附件删除失败 (${res.status})`);
  }
}

export async function restoreLibraryTrash(id: string): Promise<Document> {
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
