"use client";

import JSZip from "jszip";
import type { AssetMeta, Document, TrashItem } from "../types";
import type { Annotation } from "../annotations";
import type { ReadingPrefs } from "../readingPrefs";
import { getTags } from "../tags";
import { getAssetBlob, putAssetBlob, base64ToBlob, blobToBase64 } from "../assets/store";

export const BACKUP_MANIFEST_VERSION = 2;

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
  assets?: AssetMeta[];
  annotations?: Annotation[];
  readingPrefs?: ReadingPrefs;
};

export type BackupPayload = {
  documents: Document[];
  trash: TrashItem[];
  assets?: AssetMeta[];
  annotations?: Annotation[];
  readingPrefs?: ReadingPrefs;
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

  const assets = payload.assets || [];
  for (const a of assets) {
    const blob = await getAssetBlob(a.id);
    if (!blob) continue;
    const rel = safeZipPath(a.path);
    folder.file(`files/${rel}`, blob);
  }

  if (payload.annotations?.length) {
    folder.file("annotations.json", JSON.stringify(payload.annotations, null, 2));
  }

  const manifest: BackupManifest = {
    format: "langhuan-backup",
    version: BACKUP_MANIFEST_VERSION,
    exportedAt: Date.now(),
    app: "琅嬛 Langhuan",
    documents: docsMeta,
    trash: trashMeta,
    assets,
    annotations: payload.annotations,
    readingPrefs: payload.readingPrefs,
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

function looksLikeAssetPath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(p);
}

/**
 * Parse a Langhuan backup zip (or a plain folder of .md/.html).
 * Restores binary assets into IndexedDB when present.
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

    const assets: AssetMeta[] = [];
    for (const a of manifest.assets || []) {
      const candidates = [
        `${root}files/${safeZipPath(a.path)}`,
        `files/${safeZipPath(a.path)}`,
      ];
      for (const c of candidates) {
        if (zip.files[c]) {
          const blob = await zip.files[c].async("blob");
          const typed = blob.type ? blob : new Blob([blob], { type: a.mime });
          await putAssetBlob(a.id, typed);
          assets.push({ ...a, size: typed.size || a.size });
          break;
        }
      }
    }

    let annotations: Annotation[] | undefined = manifest.annotations;
    const annName = names.find(
      (n) => n === "annotations.json" || n.endsWith("/annotations.json")
    );
    if (annName) {
      try {
        annotations = JSON.parse(await zip.files[annName].async("string")) as Annotation[];
      } catch {
        /* keep manifest copy */
      }
    }

    return {
      documents,
      trash,
      assets,
      annotations,
      readingPrefs: manifest.readingPrefs,
    };
  }

  // Fallback: treat zip as a loose tree of markdown/html (+ images)
  const documents: Document[] = [];
  const assets: AssetMeta[] = [];
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const rel = name.replace(/^[^/]+\//, "");
    if (rel.startsWith("_trash/")) continue;
    if (looksLikeDocPath(rel)) {
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
    } else if (looksLikeAssetPath(rel)) {
      const blob = await entry.async("blob");
      const id = `asset_${Math.random().toString(36).slice(2, 10)}`;
      const mime = blob.type || "application/octet-stream";
      await putAssetBlob(id, blob);
      assets.push({
        id,
        path: rel,
        mime,
        size: blob.size,
        createdAt: Date.now(),
      });
    }
  }
  if (!documents.length && !assets.length) {
    throw new Error("压缩包中没有可导入的 .md / .html / 图片文件");
  }
  return { documents, trash: [], assets };
}

// re-export helpers used by tests / tooling
export { blobToBase64, base64ToBlob };
