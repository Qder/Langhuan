import type { Document } from "./types";
import { extractWikiLinks } from "./wikilink";
import { getDocMeta } from "./docMeta";
import { basename, titleOf } from "./utils";
import type { SearchHit } from "./search/types";
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

export function findBacklinks(docs: Document[], target: Document): Document[] {
  const meta = getDocMeta(target);
  const names = new Set([
    titleOf(target.path),
    basename(target.path),
    target.path,
    ...meta.aliases,
  ]);
  return docs.filter((d) => {
    if (d.id === target.id || d.type !== "md") return false;
    return extractWikiLinks(d.content).some((r) => names.has(r.target));
  });
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
    docs.find((d) => d.path.endsWith("/" + n) || d.path.endsWith("/" + n + ".md"));
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
