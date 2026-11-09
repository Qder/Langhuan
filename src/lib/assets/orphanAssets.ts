/**
 * Find library assets not referenced by any document body.
 * Confirm list before delete — does not auto-remove.
 */

import type { AssetMeta, Document } from "../types";

const MD_IMG = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*(?:(["'])(.*?)\2)?\s*\)/g;
const HTML_IMG = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

function collectRefs(content: string): string[] {
  const out: string[] = [];
  MD_IMG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_IMG.exec(content))) out.push(m[1] || "");
  HTML_IMG.lastIndex = 0;
  while ((m = HTML_IMG.exec(content))) out.push(m[1] || "");
  return out.map((s) => s.replace(/\\/g, "/").trim()).filter(Boolean);
}

function pathTail(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

/** True if any doc body mentions this asset path / basename. */
export function assetIsReferenced(
  asset: AssetMeta,
  documents: Document[],
  getContent?: (doc: Document) => string
): boolean {
  const assetPath = asset.path.replace(/\\/g, "/");
  const base = pathTail(assetPath);
  for (const d of documents) {
    const body = getContent ? getContent(d) : d.content;
    for (const ref of collectRefs(body)) {
      if (ref.startsWith("http:") || ref.startsWith("https:") || ref.startsWith("data:")) {
        continue;
      }
      const norm = ref.replace(/^\.\//, "");
      if (norm === assetPath || norm.endsWith("/" + base) || pathTail(norm) === base) {
        return true;
      }
      // doc-relative ./assets/x under same folder
      if (norm.includes("assets/") && pathTail(norm) === base) return true;
    }
  }
  return false;
}

export function findOrphanAssets(
  documents: Document[],
  assets: AssetMeta[],
  getContent?: (doc: Document) => string
): AssetMeta[] {
  return assets.filter((a) => !assetIsReferenced(a, documents, getContent));
}
