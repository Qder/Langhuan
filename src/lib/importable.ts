import type { Document } from "./types";
import { mimeFromExt } from "./assets/paths";

/** Extensions the library can store as text documents. */
export const IMPORTABLE_EXT_RE = /\.(md|html|txt|svg)$/i;

/** Binary image extensions imported as AssetMeta (folder / multi-file batches). */
export const IMPORTABLE_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

/** File picker accept list (comma-separated) — text documents only. */
export const IMPORTABLE_ACCEPT =
  ".md,.html,.txt,.svg,text/markdown,text/html,image/svg+xml";

/** Optional accept for folder pickers that also want images. */
export const IMPORTABLE_FOLDER_ACCEPT =
  `${IMPORTABLE_ACCEPT},image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif`;

export function isImportableLibraryPath(path: string): boolean {
  return IMPORTABLE_EXT_RE.test(path.replace(/\\/g, "/"));
}

export function isImportableImagePath(path: string): boolean {
  return IMPORTABLE_IMAGE_EXT_RE.test(path.replace(/\\/g, "/"));
}

/** Map path extension to Document.type. .svg is stored as html (SVG markup). */
export function libraryDocTypeFromPath(path: string): Document["type"] {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".svg")) return "html";
  return "md";
}

/** Normalize .txt imports to .md paths. */
export function normalizeImportedPath(path: string): string {
  const p = path.replace(/\\/g, "/");
  if (p.toLowerCase().endsWith(".txt")) return p.replace(/\.txt$/i, ".md");
  return p;
}

/** Prefer File.type when it is image/*; else derive from extension. */
export function mimeForImportableImage(path: string, fileMime?: string): string {
  const mime = (fileMime || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return mime;
  const m = path.replace(/\\/g, "/").toLowerCase().match(/\.([a-z0-9]+)$/);
  return mimeFromExt(m?.[1] || "png");
}
