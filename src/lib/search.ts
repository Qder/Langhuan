import type { Document } from "./types";
import { extractWikiLinks } from "./wikilink";
import { getDocMeta } from "./docMeta";
import { basename, titleOf } from "./utils";
import type { SearchHit } from "./search/types";
import { parseSearchQuery, segmentTerms } from "./searchQuery";
import { searchDocumentsLegacy } from "./search/legacy";
import { searchWithIndex } from "./search/queryEngine";
import {
  ensureSearchIndex,
  getSearchIndex,
  isSearchIndexReady,
  tryBindStoreFromModule,
} from "./search/runtime";

export type { SearchHit } from "./search/types";

/**
 * Full-text search over documents.
 * Uses the in-memory inverted index when ready; otherwise the legacy substring path
 * (also used while a chunked rebuild is in flight).
 */
export function searchDocuments(docs: Document[], query: string): SearchHit[] {
  tryBindStoreFromModule();
  const ready = ensureSearchIndex(docs) && isSearchIndexReady();
  if (ready) {
    return searchWithIndex(getSearchIndex(), docs, query);
  }
  return searchDocumentsLegacy(docs, query);
}


/**
 * First case-insensitive exact hit of the ⌘K query inside document content.
 * Title/path-only hits (needle not in content) → null; open without reveal.
 * Does not change search ranking — only plans locate after open.
 */
export function planSearchOpenReveal(
  content: string,
  query: string
): { start: number; end: number } | null {
  if (!content || !query.trim()) return null;
  const parsed = parseSearchQuery(query);
  const needles: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (!v) return;
    if (!needles.some((n) => n.toLowerCase() === v.toLowerCase())) needles.push(v);
  };
  push(parsed.text);
  for (const t of segmentTerms(parsed.text)) push(t);
  for (const ph of parsed.phrases) push(ph);
  if (!needles.length) return null;

  const lower = content.toLowerCase();
  let best: { start: number; end: number } | null = null;
  for (const n of needles) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx < 0) continue;
    const end = idx + n.length;
    if (!best || idx < best.start) best = { start: idx, end };
  }
  return best;
}

export type BacklinkHit = {
  docId: string;
  path: string;
  start: number;
  end: number;
  /** One-line excerpt around the [[...]] (≈80 chars). */
  excerpt: string;
};

function targetLinkNames(target: Document): Set<string> {
  const meta = getDocMeta(target);
  return new Set([
    titleOf(target.path),
    basename(target.path),
    target.path,
    ...meta.aliases,
  ]);
}

/** Compact excerpt around [start,end), total length about maxLen. */
export function excerptAround(
  content: string,
  start: number,
  end: number,
  maxLen = 80
): string {
  const safeStart = Math.max(0, Math.min(start, content.length));
  const safeEnd = Math.max(safeStart, Math.min(end, content.length));
  const core = content.slice(safeStart, safeEnd);
  const budget = Math.max(0, maxLen - core.length);
  const beforeBudget = Math.floor(budget / 2);
  const afterBudget = budget - beforeBudget;
  let from = Math.max(0, safeStart - beforeBudget);
  let to = Math.min(content.length, safeEnd + afterBudget);
  // Prefer breaking on whitespace when we have slack
  if (from > 0) {
    const sp = content.lastIndexOf(" ", safeStart - 1);
    if (sp >= from - 12 && sp < safeStart) from = sp + 1;
  }
  if (to < content.length) {
    const sp = content.indexOf(" ", safeEnd);
    if (sp >= 0 && sp <= to + 12) to = sp;
  }
  let excerpt = content.slice(from, to).replace(/\s+/g, " ").trim();
  if (from > 0) excerpt = "…" + excerpt;
  if (to < content.length) excerpt = excerpt + "…";
  return excerpt;
}

/**
 * Every resolved [[current]] (or alias/path form) in other Markdown notes.
 * One physical link → one hit; same source doc may contribute many hits.
 * Skips self-links, HTML docs, and unresolved targets.
 */
export function listBacklinkHits(docs: Document[], current: Document): BacklinkHit[] {
  const names = targetLinkNames(current);
  const hits: BacklinkHit[] = [];
  for (const d of docs) {
    if (d.id === current.id || d.type !== "md") continue;
    for (const r of extractWikiLinks(d.content)) {
      if (!r.target || !names.has(r.target)) continue;
      // Unresolved would not match names; self already skipped.
      hits.push({
        docId: d.id,
        path: d.path,
        start: r.start,
        end: r.end,
        excerpt: excerptAround(d.content, r.start, r.end),
      });
    }
  }
  return hits;
}

export function findBacklinks(docs: Document[], target: Document): Document[] {
  const names = targetLinkNames(target);
  return docs.filter((d) => {
    if (d.id === target.id || d.type !== "md") return false;
    return extractWikiLinks(d.content).some((r) => names.has(r.target));
  });
}

/**
 * Stable string key for Zustand selectors: same backlink set → Object.is-equal
 * string. Do NOT put fresh `{...}` arrays through useShallow (element Object.is
 * always fails → infinite getSnapshot loop).
 */
export function backlinkEqualityKey(docs: Document[], target: Document): string {
  const links = findBacklinks(docs, target);
  return [
    `${target.id}\0${target.path}\0${target.updatedAt}`,
    ...links.map((d) => `${d.id}\0${d.path}\0${d.updatedAt}`),
  ].join("\n");
}

export function countAllBacklinks(docs: Document[]): number {
  let n = 0;
  for (const d of docs) {
    if (d.type !== "md") continue;
    n += extractWikiLinks(d.content).filter((r) => !r.embed).length;
  }
  return n;
}

export function resolveWikiTarget(docs: Document[], name: string): Document | undefined {
  const n = name.trim();
  if (!n) return undefined;
  const byTitle =
    docs.find((d) => titleOf(d.path) === n) ||
    docs.find((d) => basename(d.path) === n) ||
    docs.find((d) => d.path === n) ||
    docs.find((d) => d.path.replace(/\.(md|html)$/i, "") === n) ||
    docs.find(
      (d) =>
        d.path.endsWith("/" + n) ||
        d.path.endsWith("/" + n + ".md") ||
        d.path.endsWith("/" + n + ".html")
    );
  if (byTitle) return byTitle;
  return docs.find((d) => getDocMeta(d).aliases.includes(n));
}

export { parseSearchQuery, segmentTerms } from "./searchQuery";
export { searchDocumentsLegacy } from "./search/legacy";
export {
  buildSearchIndexSync,
  resetSearchIndexForTests,
  isSearchIndexReady,
} from "./search/runtime";
