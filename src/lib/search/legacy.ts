/**
 * Original substring search (pre-index). Kept as recall fallback while the
 * inverted index is building, and as the behavioral reference for tests.
 */
import type { Document } from "../types";
import { getDocMeta } from "../docMeta";
import { getTags } from "../tags";
import { stripHtml, titleOf } from "../utils";
import { parseSearchQuery, segmentTerms } from "../searchQuery";
import type { SearchHit } from "./types";

function scoreField(hay: string, terms: string[], weight: number): number {
  if (!terms.length) return 0;
  const h = hay.toLowerCase();
  let s = 0;
  let matched = 0;
  for (const t of terms) {
    if (!t) continue;
    if (!h.includes(t)) continue;
    matched += 1;
    s += weight;
    if (h.startsWith(t)) s += weight * 0.5;
  }
  if (matched === 0) return 0;
  if (terms.length >= 2 && matched < Math.ceil(terms.length * 0.5)) return 0;
  return s;
}

function snippetAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let i = 0;
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx >= 0) {
      i = idx;
      break;
    }
  }
  const start = Math.max(0, i - 24);
  const end = Math.min(text.length, i + (terms[0]?.length || 0) + 56);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export function searchDocumentsLegacy(docs: Document[], query: string): SearchHit[] {
  const parsed = parseSearchQuery(query);
  const terms = segmentTerms(parsed.text);
  const hasFilters = parsed.tags.length > 0 || !!parsed.path || !!parsed.type;
  if (!terms.length && !hasFilters) return [];

  const hits: SearchHit[] = [];
  for (const d of docs) {
    if (parsed.type && d.type !== parsed.type) continue;
    if (parsed.path && !d.path.toLowerCase().includes(parsed.path.toLowerCase())) continue;
    if (parsed.tags.length) {
      const tags = getTags(d);
      if (!parsed.tags.every((t) => tags.includes(t))) continue;
    }

    const title = titleOf(d.path);
    const meta = getDocMeta(d);
    const tags = getTags(d).join(" ");
    const aliases = meta.aliases.join(" ");
    const body =
      d.type === "html"
        ? stripHtml(d.content)
        : d.content.replace(/^---[\s\S]*?---\s*/, "");

    let score = 0;
    if (terms.length) {
      score += scoreField(title, terms, 10);
      score += scoreField(aliases, terms, 8);
      score += scoreField(d.path, terms, 6);
      score += scoreField(tags, terms, 5);
      score += scoreField(body, terms, 1);
      if (score <= 0) continue;
    } else {
      score = 1;
    }

    hits.push({
      id: d.id,
      path: d.path,
      type: d.type,
      score,
      snippet: snippetAround(body.replace(/\s+/g, " ").trim(), terms.length ? terms : [""]),
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "zh"));
}
