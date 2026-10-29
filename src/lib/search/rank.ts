import type { SearchField } from "./index";

/**
 * Tunable ranking weights. Keep changes centralized here.
 * Field priority: title > tags > path > body (aliases sit just under title).
 */
export const RANK_WEIGHTS = {
  field: {
    title: 12,
    aliases: 10,
    tags: 8,
    path: 5,
    body: 1,
  } satisfies Record<SearchField, number>,
  /** Multipliers on top of field weight for match quality. */
  match: {
    exactToken: 1.0,
    prefix: 0.65,
    substring: 0.4,
  },
  /** Bonus when every query term hits at least one field. */
  allTermsBonus: 4,
  /** Bonus when two consecutive query terms appear near each other in a field. */
  phraseAdjacency: 3,
  /** log1p(tf) saturation coefficient (applied after field×match). */
  tfLogScale: 1,
  /**
   * Tiny recency bump: weight * (1 / (1 + ageDays)).
   * Must stay far below a single body hit (~1) so it cannot overturn relevance.
   */
  recency: 0.15,
  /** Soft-AND: fraction of terms a single field must match to score (legacy-compatible). */
  fieldMatchFraction: 0.5,
} as const;

export type RankTermHit = {
  term: string;
  /** best quality for this term in this field */
  quality: "exact" | "prefix" | "substring";
  tf: number;
};

function qualityScore(q: RankTermHit["quality"]): number {
  if (q === "exact") return RANK_WEIGHTS.match.exactToken;
  if (q === "prefix") return RANK_WEIGHTS.match.prefix;
  return RANK_WEIGHTS.match.substring;
}

function countOccurrences(hay: string, term: string, cap = 8): number {
  if (!term) return 0;
  let n = 0;
  let from = 0;
  while (from <= hay.length && n < cap) {
    const i = hay.indexOf(term, from);
    if (i < 0) break;
    n += 1;
    from = i + Math.max(term.length, 1);
  }
  return n;
}

function isBoundaryChar(ch: string | undefined): boolean {
  if (!ch) return true;
  const c = ch.charCodeAt(0);
  // space / ASCII punct; treat CJK as non-boundary (exact = whole run match handled loosely)
  if (c <= 32) return true;
  if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
  return false;
}

/** Classify how `term` appears in `hay` (both already normalized / lowercased). */
export function classifyMatch(hay: string, term: string): RankTermHit | null {
  if (!term || !hay.includes(term)) return null;
  const tf = countOccurrences(hay, term);
  let quality: RankTermHit["quality"] = "substring";
  const idx = hay.indexOf(term);
  const end = idx + term.length;
  if (isBoundaryChar(hay[idx - 1]) && isBoundaryChar(hay[end])) {
    quality = "exact";
  } else if (hay.startsWith(term) || isBoundaryChar(hay[idx - 1])) {
    quality = "prefix";
  }
  return { term, quality, tf };
}

export function scoreFieldRanked(hay: string, terms: string[], field: SearchField): number {
  if (!terms.length || !hay) return 0;
  const hits: RankTermHit[] = [];
  for (const t of terms) {
    const h = classifyMatch(hay, t);
    if (h) hits.push(h);
  }
  if (!hits.length) return 0;
  const need = terms.length >= 2 ? Math.ceil(terms.length * RANK_WEIGHTS.fieldMatchFraction) : 1;
  if (hits.length < need) return 0;

  const fw = RANK_WEIGHTS.field[field];
  let s = 0;
  for (const h of hits) {
    const tfPart = Math.log1p(h.tf) * RANK_WEIGHTS.tfLogScale;
    s += fw * qualityScore(h.quality) * (0.65 + 0.35 * tfPart);
  }

  // Phrase adjacency: consecutive query terms within ~24 chars
  for (let i = 0; i < terms.length - 1; i++) {
    const a = terms[i];
    const b = terms[i + 1];
    if (!a || !b) continue;
    const ia = hay.indexOf(a);
    if (ia < 0) continue;
    const ib = hay.indexOf(b, ia + a.length);
    if (ib < 0) continue;
    if (ib - (ia + a.length) <= 24) s += RANK_WEIGHTS.phraseAdjacency;
  }
  return s;
}

export function scoreDocumentRanked(
  fields: Record<SearchField, string>,
  terms: string[],
  updatedAt: number,
  now = Date.now()
): number {
  if (!terms.length) return 1;
  const order: SearchField[] = ["title", "aliases", "tags", "path", "body"];
  let score = 0;
  const covered = new Set<string>();
  for (const f of order) {
    const part = scoreFieldRanked(fields[f], terms, f);
    score += part;
    if (part > 0) {
      for (const t of terms) {
        if (fields[f].includes(t)) covered.add(t);
      }
    }
  }
  if (score <= 0) return 0;
  if (covered.size === terms.length) score += RANK_WEIGHTS.allTermsBonus;

  const ageDays = Math.max(0, (now - updatedAt) / 86_400_000);
  score += RANK_WEIGHTS.recency / (1 + ageDays);
  return score;
}
