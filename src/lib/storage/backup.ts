"use client";

import JSZip from "jszip";
import type { Document, TrashItem } from "../types";
import { getTags } from "../tags";

export const BACKUP_MANIFEST_VERSION = 1;

export type BackupManifest = {
  format: "langhuan-backup";
  version: typeof BACKUP_MANIFEST_VERSION;
  exportedAt: number;
  app: string;
  documents: Array<{
    id: string;
    path: string;
    type: Document["type"];
    starred: boolean;
    createdAt: number;
    updatedAt: number;
    tags: string[];
  }>;
  trash?: Array<{
    deletedAt: number;
    doc: BackupManifest["documents"][number];
  }>;
};

export type BackupPayload = {
  documents: Document[];
  trash: TrashItem[];
};

function safeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\./g, "_");
}

export async function buildLibraryZip(payload: BackupPayload): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder("langhuan-backup")!;
  const docsMeta: BackupManifest["documents"] = [];

  for (const d of payload.documents) {
    const rel = safeZipPath(d.path);
    folder.file(`files/${rel}`, d.content);
    docsMeta.push({
      id: d.id,
      path: d.path,
      type: d.type,
      starred: d.starred,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      tags: getTags(d),
    });
  }

  const trashMeta: BackupManifest["trash"] = [];
  for (const t of payload.trash) {
    const d = t.doc;
    const rel = safeZipPath(`_trash/${d.id}__${safeZipPath(d.path)}`);
    folder.file(`files/${rel}`, d.content);
    trashMeta.push({
      deletedAt: t.deletedAt,
      doc: {
        id: d.id,
        path: d.path,
        type: d.type,
        starred: d.starred,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        tags: getTags(d),
      },
    });
  }

  const manifest: BackupManifest = {
    format: "langhuan-backup",
    version: BACKUP_MANIFEST_VERSION,
    exportedAt: Date.now(),
    app: "琅嬛 Langhuan",
    documents: docsMeta,
    trash: trashMeta,
  };
  folder.file("manifest.json", JSON.stringify(manifest, null, 2));

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function defaultBackupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `langhuan-backup-${stamp}.zip`;
}

function looksLikeDocPath(p: string): boolean {
  return /\.(md|html|htm|txt)$/i.test(p);
}

/**
 * Parse a Langhuan backup zip (or a plain folder of .md/.html).
 */
export async function parseLibraryZip(file: Blob): Promise<BackupPayload> {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);

  const manifestName = names.find(
    (n) => n === "manifest.json" || n.endsWith("/manifest.json")
  );

  if (manifestName) {
    const raw = await zip.files[manifestName].async("string");
    const manifest = JSON.parse(raw) as BackupManifest;
    if (manifest.format !== "langhuan-backup") {
      throw new Error("不是琅嬛备份包（manifest.format 不匹配）");
    }
    const root = manifestName.includes("/")
      ? manifestName.slice(0, manifestName.lastIndexOf("/") + 1)
      : "";

    const documents: Document[] = [];
    for (const meta of manifest.documents || []) {
      const candidates = [
        `${root}files/${safeZipPath(meta.path)}`,
        `files/${safeZipPath(meta.path)}`,
        safeZipPath(meta.path),
      ];
      let content = "";
      for (const c of candidates) {
        if (zip.files[c]) {
          content = await zip.files[c].async("string");
          break;
        }
      }
      documents.push({
        id: meta.id,
        path: meta.path,
        type: meta.type,
        content,
        starred: !!meta.starred,
        createdAt: meta.createdAt || Date.now(),
        updatedAt: meta.updatedAt || Date.now(),
      });
    }

    const trash: TrashItem[] = [];
    for (const t of manifest.trash || []) {
      const meta = t.doc;
      const candidates = [
        `${root}files/_trash/${meta.id}__${safeZipPath(meta.path)}`,
        `files/_trash/${meta.id}__${safeZipPath(meta.path)}`,
      ];
      let content = "";
      for (const c of candidates) {
        if (zip.files[c]) {
          content = await zip.files[c].async("string");
          break;
        }
      }
      trash.push({
        deletedAt: t.deletedAt,
        doc: {
          id: meta.id,
          path: meta.path,
          type: meta.type,
          content,
          starred: !!meta.starred,
          createdAt: meta.createdAt || Date.now(),
          updatedAt: meta.updatedAt || Date.now(),
        },
      });
    }

    return { documents, trash };
  }

  // Fallback: treat zip as a loose tree of markdown/html
  const documents: Document[] = [];
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const rel = name.replace(/^[^/]+\//, ""); // strip top folder if any
    if (!looksLikeDocPath(rel)) continue;
    if (rel.startsWith("_trash/")) continue;
    const content = await entry.async("string");
    const type = /\.html?$/i.test(rel) ? "html" : "md";
    const path = rel.replace(/\.txt$/i, ".md");
    documents.push({
      id: `import_${Math.random().toString(36).slice(2, 10)}`,
      path,
      type,
      content,
      starred: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (!documents.length) throw new Error("压缩包中没有可导入的 .md / .html 文件");
  return { documents, trash: [] };
}
