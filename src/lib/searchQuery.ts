/**
 * Search filter syntax + Chinese segmentation helpers.
 * Filters: tag:x path:y type:html|md title:x  (rest is free text)
 * Also: "exact phrase", -exclude  (optional; plain queries unchanged)
 */

export type ParsedSearchQuery = {
  text: string;
  tags: string[];
  path?: string;
  type?: "md" | "html";
  /** title:xxx filters (AND, matched against titleOf(path) + aliases) */
  titles: string[];
  /** Quoted "exact phrases" extracted from free text */
  phrases: string[];
  /** -exclude terms (matched against searchable fields; doc dropped if any hit) */
  excludes: string[];
};

const FILTER_RE = /(?:^|\s)(tag|path|type|title):(?:"([^"]+)"|(\S+))/gi;

/**
 * Parse query operators. On unclosed quotes or other soft failures, falls back
 * to treating the remainder as plain text (never throws).
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const tags: string[] = [];
  const titles: string[] = [];
  const phrases: string[] = [];
  const excludes: string[] = [];
  let path: string | undefined;
  let type: "md" | "html" | undefined;

  let text = raw ?? "";

  // Detect unclosed quote → treat entire string as plain (keep filters that already closed).
  const quoteCount = (text.match(/"/g) || []).length;
  const unclosed = quoteCount % 2 === 1;

  text = text.replace(FILTER_RE, (_, key: string, quoted: string, bare: string) => {
    const val = (quoted ?? bare ?? "").trim();
    const k = key.toLowerCase();
    if (k === "tag" && val) tags.push(val);
    else if (k === "path" && val) path = val;
    else if (k === "title" && val) titles.push(val);
    else if (k === "type") {
      const t = val.toLowerCase();
      if (t === "md" || t === "markdown") type = "md";
      else if (t === "html" || t === "htm") type = "html";
    }
    return " ";
  });

  if (!unclosed) {
    // Extract "phrases"
    text = text.replace(/"([^"]+)"/g, (_, p: string) => {
      const v = p.trim();
      if (v) phrases.push(v);
      return " ";
    });
  }

  // -exclude tokens (not part of a word like mid-word)
  const restParts: string[] = [];
  for (const part of text.split(/(\s+)/)) {
    if (!part || /^\s+$/.test(part)) {
      if (part) restParts.push(part);
      continue;
    }
    if (/^-[\u4e00-\u9fffA-Za-z0-9_]/.test(part)) {
      const ex = part.slice(1).trim();
      if (ex) excludes.push(ex);
      continue;
    }
    restParts.push(part);
  }
  text = restParts.join("");

  return {
    text: text.replace(/\s+/g, " ").trim(),
    tags,
    path,
    type,
    titles,
    phrases,
    excludes,
  };
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
