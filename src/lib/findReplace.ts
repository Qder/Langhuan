/**
 * Library-wide literal find & replace (no regex in v1).
 * Replacements operate on original source offsets — never on normalized search text.
 */

import { frontmatterOffset, lineAtOffset } from "./locate/frontmatter";
import { isPathUnderFolder, normalizeFolderPath } from "./folders";
import { dirname } from "./utils";
import type { DocType, Document } from "./types";

export const FIND_REPLACE_PREVIEW_CAP = 500;

export type FindReplaceScope = "current" | "folder" | "library";
export type FindReplaceFileTypes = "md" | "html" | "all";

export type FindReplaceQuery = {
  find: string;
  replaceWith: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: FindReplaceScope;
  fileTypes: FindReplaceFileTypes;
  /** When false (default), Markdown YAML front matter is skipped. */
  includeFrontMatter: boolean;
};

export type FindHit = {
  docId: string;
  path: string;
  docType: DocType;
  /** Byte offset in full document content (LF-normalized caller responsibility). */
  start: number;
  end: number;
  line: number;
  /** Single source line containing the hit. */
  lineText: string;
  /** Mark range within lineText for highlight rendering. */
  markStart: number;
  markEnd: number;
};

export type DocFindResult = {
  docId: string;
  path: string;
  docType: DocType;
  hits: FindHit[];
  /** True when hits were truncated for preview (> FIND_REPLACE_PREVIEW_CAP). */
  truncated: boolean;
  /** Total matches in this doc (including those beyond preview cap). */
  totalCount: number;
};

function isAsciiWordChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    c === 95 // _
  );
}

/** Whole-word: ASCII uses \b-like edges; CJK is per-character (no false \b). */
export function isWholeWordAt(
  text: string,
  start: number,
  end: number
): boolean {
  if (start < 0 || end > text.length || end <= start) return false;
  const before = start > 0 ? text[start - 1]! : "";
  const after = end < text.length ? text[end]! : "";
  const first = text[start]!;
  const last = text[end - 1]!;
  if (before && isAsciiWordChar(before) && isAsciiWordChar(first)) return false;
  if (after && isAsciiWordChar(after) && isAsciiWordChar(last)) return false;
  return true;
}

export type MatchRange = { start: number; end: number };

/**
 * Find all literal occurrences in `content` within optional [rangeStart, rangeEnd).
 */
export function findLiteralRanges(
  content: string,
  find: string,
  opts: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    rangeStart?: number;
    rangeEnd?: number;
  } = {}
): MatchRange[] {
  if (!find) return [];
  const caseSensitive = !!opts.caseSensitive;
  const wholeWord = !!opts.wholeWord;
  const rangeStart = Math.max(0, opts.rangeStart ?? 0);
  const rangeEnd = Math.min(content.length, opts.rangeEnd ?? content.length);
  if (rangeEnd <= rangeStart) return [];

  const slice = content.slice(rangeStart, rangeEnd);
  const hay = caseSensitive ? slice : slice.toLowerCase();
  const ned = caseSensitive ? find : find.toLowerCase();
  if (!ned.length) return [];
  // Guard against Unicode case-fold length drift (rare); fall back to case-sensitive length.
  const matchLen = find.length;
  if (!caseSensitive && ned.length !== matchLen) {
    // Still search with ned, but end = start + ned.length mapped back — use ned.length on hay.
  }
  const endLen = caseSensitive ? matchLen : ned.length;

  const out: MatchRange[] = [];
  let from = 0;
  while (from <= hay.length - endLen) {
    const i = hay.indexOf(ned, from);
    if (i < 0) break;
    const absStart = rangeStart + i;
    const absEnd = absStart + endLen;
    if (!wholeWord || isWholeWordAt(content, absStart, absEnd)) {
      out.push({ start: absStart, end: absEnd });
    }
    from = i + Math.max(1, endLen);
  }
  return out;
}

function lineBounds(content: string, offset: number): { lineStart: number; lineEnd: number } {
  let lineStart = offset;
  while (lineStart > 0 && content[lineStart - 1] !== "\n") lineStart -= 1;
  let lineEnd = offset;
  while (lineEnd < content.length && content[lineEnd] !== "\n") lineEnd += 1;
  return { lineStart, lineEnd };
}

export function rangesToHits(
  content: string,
  doc: Pick<Document, "id" | "path" | "type">,
  ranges: MatchRange[]
): FindHit[] {
  return ranges.map((r) => {
    const { lineStart, lineEnd } = lineBounds(content, r.start);
    const lineText = content.slice(lineStart, lineEnd);
    return {
      docId: doc.id,
      path: doc.path,
      docType: doc.type,
      start: r.start,
      end: r.end,
      line: lineAtOffset(content, r.start),
      lineText,
      markStart: r.start - lineStart,
      markEnd: Math.min(lineText.length, r.end - lineStart),
    };
  });
}

/** Body search window for a document given query flags. */
export function contentSearchWindow(
  content: string,
  docType: DocType,
  includeFrontMatter: boolean
): { start: number; end: number } {
  if (docType === "md" && !includeFrontMatter) {
    const fm = frontmatterOffset(content);
    return { start: fm, end: content.length };
  }
  return { start: 0, end: content.length };
}

export function filterDocsForFindReplace(
  documents: Document[],
  query: Pick<FindReplaceQuery, "scope" | "fileTypes">,
  ctx: { activeId: string | null; activePath?: string | null }
): Document[] {
  let docs = documents;
  if (query.fileTypes === "md") docs = docs.filter((d) => d.type === "md");
  else if (query.fileTypes === "html") docs = docs.filter((d) => d.type === "html");

  if (query.scope === "current") {
    if (!ctx.activeId) return [];
    return docs.filter((d) => d.id === ctx.activeId);
  }
  if (query.scope === "folder") {
    const path = ctx.activePath || "";
    const folder = normalizeFolderPath(dirname(path));
    if (!folder) {
      // Root-level active doc: only other root docs (no slash in dirname).
      return docs.filter((d) => !normalizeFolderPath(dirname(d.path)));
    }
    return docs.filter((d) => isPathUnderFolder(d.path, folder));
  }
  return docs;
}

export function findInDocument(
  doc: Document,
  content: string,
  query: Pick<
    FindReplaceQuery,
    "find" | "caseSensitive" | "wholeWord" | "includeFrontMatter"
  >,
  opts?: { previewCap?: number }
): DocFindResult {
  const cap = opts?.previewCap ?? FIND_REPLACE_PREVIEW_CAP;
  const win = contentSearchWindow(content, doc.type, query.includeFrontMatter);
  const ranges = findLiteralRanges(content, query.find, {
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    rangeStart: win.start,
    rangeEnd: win.end,
  });
  const totalCount = ranges.length;
  const truncated = totalCount > cap;
  const previewRanges = truncated ? ranges.slice(0, cap) : ranges;
  return {
    docId: doc.id,
    path: doc.path,
    docType: doc.type,
    hits: rangesToHits(content, doc, previewRanges),
    truncated,
    totalCount,
  };
}

export function scanFindReplace(
  documents: Document[],
  getContent: (id: string) => string,
  query: FindReplaceQuery,
  ctx: { activeId: string | null; activePath?: string | null },
  opts?: { previewCap?: number }
): DocFindResult[] {
  if (!query.find) return [];
  const docs = filterDocsForFindReplace(documents, query, ctx);
  const out: DocFindResult[] = [];
  for (const doc of docs) {
    const content = getContent(doc.id);
    const result = findInDocument(doc, content, query, opts);
    if (result.totalCount > 0) out.push(result);
  }
  return out;
}

/**
 * Replace literal matches in content. If `onlyStarts` is provided, only those
 * absolute start offsets are replaced (must still match find under the same rules).
 * Applies from end → start so offsets stay valid.
 */
export function replaceLiteralInContent(
  content: string,
  query: Pick<
    FindReplaceQuery,
    "find" | "replaceWith" | "caseSensitive" | "wholeWord" | "includeFrontMatter"
  > & { docType: DocType },
  onlyStarts?: Iterable<number> | null
): { content: string; count: number } {
  if (!query.find) return { content, count: 0 };
  const win = contentSearchWindow(content, query.docType, query.includeFrontMatter);
  let ranges = findLiteralRanges(content, query.find, {
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    rangeStart: win.start,
    rangeEnd: win.end,
  });
  if (onlyStarts) {
    const allow = new Set(onlyStarts);
    ranges = ranges.filter((r) => allow.has(r.start));
  }
  if (!ranges.length) return { content, count: 0 };

  let next = content;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    next = next.slice(0, r.start) + query.replaceWith + next.slice(r.end);
  }
  return { content: next, count: ranges.length };
}

export function summarizeScan(results: DocFindResult[]): {
  docCount: number;
  hitCount: number;
  anyTruncated: boolean;
} {
  let hitCount = 0;
  let anyTruncated = false;
  for (const r of results) {
    hitCount += r.totalCount;
    if (r.truncated) anyTruncated = true;
  }
  return { docCount: results.length, hitCount, anyTruncated };
}

/** Stable key for a hit checkbox. */
export function hitKey(hit: Pick<FindHit, "docId" | "start">): string {
  return `${hit.docId}:${hit.start}`;
}
