/**
 * Resolve relative media/attachment URLs against a document path in the in-app library.
 *
 * Resolution order: absolute URL → library doc (data:/SVG) → binary AssetMeta path → missing.
 */

import type { Document } from "./types";
import { basename, dirname, extOf } from "./utils";

const ABSOLUTE_RE = /^(https?:|data:|blob:|mailto:|#)/i;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

export function isAbsoluteUrl(href: string): boolean {
  return ABSOLUTE_RE.test(href.trim());
}

/** Safely percent-decode library path segments. Invalid % sequences left as-is. */
export function decodeLibraryPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => {
      if (!seg.includes("%")) return seg;
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}

/** Lookup keys: decoded first (matches Unicode AssetMeta/Document paths), then original if different. */
export function libraryPathCandidates(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return [];
  const decoded = decodeLibraryPath(normalized);
  return decoded === normalized ? [normalized] : [decoded, normalized];
}

/** Join base dir + relative href, normalize `.` / `..`. */
export function resolveAgainstDocPath(docPath: string, href: string): string {
  const raw = href.trim().split(/[?#]/)[0] || "";
  if (!raw || isAbsoluteUrl(raw)) return raw;
  const baseDir = dirname(docPath.replace(/\\/g, "/"));
  // Decode percent-encoded segments (common in MD links with CJK filenames) so the
  // resolved path matches Unicode AssetMeta.path / Document.path from folder import.
  const joined = raw.startsWith("/")
    ? raw.replace(/^\/+/, "")
    : [baseDir, raw].filter(Boolean).join("/");
  const parts: string[] = [];
  for (const seg of joined.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(decodeLibraryPath(seg));
  }
  return parts.join("/");
}

export function findDocByLibraryPath(
  docs: Document[],
  resolvedPath: string
): Document | undefined {
  const candidates = libraryPathCandidates(resolvedPath);
  if (!candidates.length) return undefined;
  for (const p of candidates) {
    const exact = docs.find((d) => d.path === p);
    if (exact) return exact;
    const lower = p.toLowerCase();
    const byLower = docs.find((d) => d.path.toLowerCase() === lower);
    if (byLower) return byLower;
  }
  // bare name without extension → try .md / .html (prefer decoded candidate)
  const p = candidates[0];
  if (!extOf(p)) {
    return (
      docs.find((d) => d.path === `${p}.md`) ||
      docs.find((d) => d.path === `${p}.html`) ||
      docs.find((d) => titleOfPath(d.path) === basename(p))
    );
  }
  return undefined;
}

function titleOfPath(path: string): string {
  return basename(path).replace(/\.(md|html|txt)$/i, "");
}

export type ResolvedMedia =
  | { kind: "external"; src: string }
  | { kind: "data"; src: string; path: string; docId?: string }
  | { kind: "asset"; path: string; assetId: string }
  | { kind: "missing"; path: string; reason: string };

export type AssetPathRef = { id: string; path: string };

/** Turn library doc content into an img src when possible. */
export function mediaSrcFromDocContent(content: string): string | null {
  const trimmed = content.trim();
  if (/^data:image\//i.test(trimmed)) {
    // single-line data URL (or data URL as entire doc)
    const firstLine = trimmed.split(/\r?\n/, 1)[0].trim();
    return firstLine;
  }
  if (/^<svg[\s>]/i.test(trimmed) || trimmed.includes("<svg")) {
    const svgMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMatch[0])}`;
    }
  }
  return null;
}

export function resolveMediaSrc(
  href: string | undefined | null,
  currentDocPath: string,
  docs: Document[],
  assets: AssetPathRef[] = []
): ResolvedMedia {
  const src = (href || "").trim();
  if (!src) return { kind: "missing", path: "", reason: "空路径" };
  if (isAbsoluteUrl(src)) return { kind: "external", src };

  const path = resolveAgainstDocPath(currentDocPath, src);
  const doc = findDocByLibraryPath(docs, path);
  if (doc) {
    const data = mediaSrcFromDocContent(doc.content);
    if (data) return { kind: "data", src: data, path: doc.path, docId: doc.id };
    // fall through — may still be an asset at same path
  }

  let asset: AssetPathRef | undefined;
  for (const candidate of libraryPathCandidates(path)) {
    asset =
      assets.find((a) => a.path === candidate) ||
      assets.find((a) => a.path.toLowerCase() === candidate.toLowerCase());
    if (asset) break;
  }
  if (asset) return { kind: "asset", path: asset.path, assetId: asset.id };

  if (doc) {
    return {
      kind: "missing",
      path: doc.path,
      reason: "库内文档不是可渲染图片（仅支持 data:image 或 SVG 文本）",
    };
  }

  const displayPath = libraryPathCandidates(path)[0] || path;
  const ext = extOf(displayPath);
  const hint = IMAGE_EXT.has(ext)
    ? "图片未入库（可粘贴/拖入图片到编辑器）"
    : "未找到对应文档";
  return { kind: "missing", path: displayPath, reason: hint };
}

export type ResolvedLink =
  | { kind: "external"; href: string }
  | { kind: "doc"; doc: Document; path: string }
  | { kind: "missing"; path: string };

export function resolveLibraryHref(
  href: string | undefined | null,
  currentDocPath: string,
  docs: Document[]
): ResolvedLink {
  const raw = (href || "").trim();
  if (!raw) return { kind: "missing", path: "" };
  if (isAbsoluteUrl(raw)) return { kind: "external", href: raw };
  const path = resolveAgainstDocPath(currentDocPath, raw);
  const doc = findDocByLibraryPath(docs, path);
  if (doc) return { kind: "doc", doc, path: doc.path };
  return { kind: "missing", path };
}
