/**
 * Pure helpers for vault attachment paths (relative to a document).
 */

import { basename, dirname, uniquePath } from "../utils";

const UNSAFE = /[/\\?%*:|"<>\u0000-\u001f]/g;

export function sanitizeAssetFilename(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).trim() || "image";
  const cleaned = base.replace(UNSAFE, "-").replace(/^\.+/, "") || "image";
  // collapse runs of dashes / spaces
  return cleaned.replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

export function extFromMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
  };
  return map[m] || "bin";
}

export function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };
  return map[e] || "application/octet-stream";
}

/** Default vault-relative path for a new paste/drop under the doc's folder. */
export function suggestAssetPath(
  docPath: string,
  filename: string,
  existingPaths: Iterable<string>,
  now = Date.now()
): string {
  const dir = dirname(docPath.replace(/\\/g, "/"));
  const safe = sanitizeAssetFilename(filename);
  const stamp = now.toString(36);
  const hasExt = /\.[a-z0-9]+$/i.test(safe);
  const name = hasExt ? safe : `${safe}.png`;
  const candidate = [dir, "assets", `${stamp}-${name}`].filter(Boolean).join("/");
  return uniquePath(candidate, new Set(existingPaths));
}

/** Relative markdown href from doc → asset (posix). */
export function relativeAssetHref(docPath: string, assetPath: string): string {
  const docDir = dirname(docPath.replace(/\\/g, "/"));
  const asset = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!docDir) return `./${asset}`;
  const docParts = docDir.split("/").filter(Boolean);
  const assetParts = asset.split("/").filter(Boolean);
  let i = 0;
  while (
    i < docParts.length &&
    i < assetParts.length &&
    docParts[i] === assetParts[i]
  ) {
    i += 1;
  }
  const ups = docParts.length - i;
  const rest = assetParts.slice(i).join("/");
  const prefix = ups === 0 ? "./" : "../".repeat(ups);
  return `${prefix}${rest}`;
}

export function markdownImageSnippet(href: string, alt = ""): string {
  const safeAlt = alt.replace(/[[\]]/g, "");
  return `![${safeAlt}](${href})`;
}

/** Paths under …/assets/ that belong to a doc folder (or shared). */
export function isAssetLikePath(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)assets\//.test(p) && !/\.(md|html?|txt)$/i.test(p);
}
