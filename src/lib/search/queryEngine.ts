import type { Document } from "../types";
import { parseSearchQuery, segmentTerms } from "../searchQuery";
import type { SearchIndex } from "./index";
import { scoreDocumentRanked } from "./rank";
import { buildSnippet } from "./snippets";
import { docPassesParsedFilters, hasActiveFilters } from "./filters";
import type { SearchHit } from "./types";

/** Snippets are only needed for visible palette rows; skip deep tail. */
const SNIPPET_TOP_K = 80;

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
  const phrases = parsed.phrases.map((p) => p.toLowerCase());
  const scoreTerms = [...terms, ...phrases];
  if (!scoreTerms.length && !hasActiveFilters(parsed)) return [];

  const byId = new Map(docs.map((d) => [d.id, d]));

  let candidateIds: Set<string>;
  if (!scoreTerms.length) {
    candidateIds = new Set(index.allDocs().map((d) => d.id));
  } else {
    const perTerm = scoreTerms.map((t) => index.candidatesForTerm(t));
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
    if (!docPassesParsedFilters(raw, parsed, indexed)) continue;

    let score: number;
    if (scoreTerms.length) {
      score = scoreDocumentRanked(indexed.fields, scoreTerms, indexed.updatedAt);
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
    const snip = buildSnippet(indexed.fields.body, scoreTerms.length ? scoreTerms : [], 40);
    hits[i].snippet = snip.text;
    hits[i].marks = snip.marks;
  }

  return hits;
}
