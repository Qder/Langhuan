/**
 * Search filter syntax + Chinese segmentation helpers.
 * Filters: tag:x path:y type:html|md  (rest is free text)
 */

export type ParsedSearchQuery = {
  text: string;
  tags: string[];
  path?: string;
  type?: "md" | "html";
};

const FILTER_RE = /(?:^|\s)(tag|path|type):(?:"([^"]+)"|(\S+))/gi;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const tags: string[] = [];
  let path: string | undefined;
  let type: "md" | "html" | undefined;
  let text = raw;

  text = text.replace(FILTER_RE, (_, key: string, quoted: string, bare: string) => {
    const val = (quoted ?? bare ?? "").trim();
    const k = key.toLowerCase();
    if (k === "tag" && val) tags.push(val);
    else if (k === "path" && val) path = val;
    else if (k === "type") {
      const t = val.toLowerCase();
      if (t === "md" || t === "markdown") type = "md";
      else if (t === "html" || t === "htm") type = "html";
    }
    return " ";
  });

  return { text: text.replace(/\s+/g, " ").trim(), tags, path, type };
}

/** Segment query into searchable terms; prefers Intl.Segmenter for CJK. */
export function segmentTerms(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Seg = (Intl as any).Segmenter;
    if (typeof Seg === "function") {
      const seg = new Seg("zh-CN", { granularity: "word" });
      const terms: string[] = [];
      for (const { segment, isWordLike } of seg.segment(q) as Iterable<{
        segment: string;
        isWordLike?: boolean;
      }>) {
        const t = segment.trim();
        if (!t) continue;
        if (isWordLike === false && !/[\u4e00-\u9fffA-Za-z0-9]/.test(t)) continue;
        if (/^[\s\p{P}]+$/u.test(t)) continue;
        terms.push(t.toLowerCase());
      }
      if (terms.length) return [...new Set(terms)];
    }
  } catch {
    /* fall through */
  }
  // Fallback: whitespace + keep CJK runs / alnum runs
  const parts = q.toLowerCase().match(/[\u4e00-\u9fff]+|[a-z0-9_]+/gi) || [];
  return [...new Set(parts.map((p) => p.toLowerCase()))];
}

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  createdAt: number;
};
