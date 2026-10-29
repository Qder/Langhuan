import type { Document } from "../types";
import { parseSearchQuery, segmentTerms } from "../searchQuery";
import { getTags } from "../tags";
import type { SearchIndex, SearchField } from "./index";
import { scoreDocumentRanked } from "./rank";
import type { SearchHit } from "./types";

function snippetAround(text: string, terms: string[]): string {
  let i = 0;
  for (const t of terms) {
    const idx = text.indexOf(t);
    if (idx >= 0) {
      i = idx;
      break;
    }
  }
  const start = Math.max(0, i - 24);
  const end = Math.min(text.length, i + (terms[0]?.length || 0) + 56);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function passesFilters(
  doc: { id: string; path: string; type: Document["type"] },
  raw: Document | undefined,
  parsed: ReturnType<typeof parseSearchQuery>
): boolean {
  if (parsed.type && doc.type !== parsed.type) return false;
  if (parsed.path && !doc.path.toLowerCase().includes(parsed.path.toLowerCase())) return false;
  if (parsed.tags.length) {
    if (!raw) return false;
    const tags = getTags(raw);
    if (!parsed.tags.every((t) => tags.includes(t))) return false;
  }
  return true;
}

/**
 * Index-backed search with ranked scoring (see rank.ts).
 */
export function searchWithIndex(
  index: SearchIndex,
  docs: Document[],
  query: string
): SearchHit[] {
  const parsed = parseSearchQuery(query);
  const terms = segmentTerms(parsed.text).map((t) => t.toLowerCase());
  const hasFilters = parsed.tags.length > 0 || !!parsed.path || !!parsed.type;
  if (!terms.length && !hasFilters) return [];

  const byId = new Map(docs.map((d) => [d.id, d]));

  let candidateIds: Set<string>;
  if (!terms.length) {
    candidateIds = new Set(index.allDocs().map((d) => d.id));
  } else {
    const perTerm = terms.map((t) => index.candidatesForTerm(t));
    const counts = new Map<string, number>();
    for (const set of perTerm) {
      for (const id of set) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const need = terms.length >= 2 ? Math.ceil(terms.length * 0.5) : 1;
    candidateIds = new Set<string>();
    for (const [id, n] of counts) {
      if (n >= need) candidateIds.add(id);
    }
    for (const d of index.allDocs()) {
      if (candidateIds.has(d.id)) continue;
      let matchedTerms = 0;
      for (const t of terms) {
        if (index.docHasSubstring(d.id, t)) matchedTerms += 1;
      }
      if (matchedTerms >= 1 && scoreDocumentRanked(d.fields, terms, d.updatedAt) > 0) {
        candidateIds.add(d.id);
      }
    }
  }

  const hits: SearchHit[] = [];
  for (const id of candidateIds) {
    const indexed = index.getDoc(id);
    const raw = byId.get(id);
    if (!indexed || !raw) continue;
    if (!passesFilters(indexed, raw, parsed)) continue;

    let score: number;
    if (terms.length) {
      score = scoreDocumentRanked(indexed.fields, terms, indexed.updatedAt);
      if (score <= 0) continue;
    } else {
      score = 1;
    }

    hits.push({
      id: indexed.id,
      path: indexed.path,
      type: indexed.type,
      score,
      snippet: snippetAround(indexed.fields.body, terms.length ? terms : [""]),
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "zh"));
}
