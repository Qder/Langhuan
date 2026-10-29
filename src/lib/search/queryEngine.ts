import type { Document } from "../types";
import { parseSearchQuery, segmentTerms } from "../searchQuery";
import { getTags } from "../tags";
import type { SearchIndex } from "./index";
import { scoreDocumentRanked } from "./rank";
import { buildSnippet } from "./snippets";
import type { SearchHit } from "./types";

/** Snippets are only needed for visible palette rows; skip deep tail. */
const SNIPPET_TOP_K = 80;

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
    candidateIds = new Set(counts.keys());
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
      snippet: "",
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "zh"));

  const top = Math.min(SNIPPET_TOP_K, hits.length);
  for (let i = 0; i < top; i++) {
    const indexed = index.getDoc(hits[i].id);
    if (!indexed) continue;
    const snip = buildSnippet(indexed.fields.body, terms.length ? terms : [], 40);
    hits[i].snippet = snip.text;
    hits[i].marks = snip.marks;
  }

  return hits;
}
