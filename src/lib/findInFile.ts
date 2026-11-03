/**
 * In-file find helpers (Ctrl/Cmd+F). Uses literal matching via findLiteralRanges.
 */

import { findLiteralRanges, type MatchRange } from "./findReplace";
import { lineAtOffset } from "./locate/frontmatter";

export type FindInFileOptions = {
  caseSensitive?: boolean;
  wholeWord?: boolean;
};

export function findInFileMatches(
  content: string,
  query: string,
  opts: FindInFileOptions = {}
): MatchRange[] {
  return findLiteralRanges(content, query, {
    caseSensitive: !!opts.caseSensitive,
    wholeWord: !!opts.wholeWord,
  });
}

/** Wrap index by dir; empty list → -1. */
export function stepFindIndex(
  current: number,
  total: number,
  dir: 1 | -1
): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) {
    return dir === 1 ? 0 : total - 1;
  }
  return (current + dir + total) % total;
}

export function describeFindHit(
  content: string,
  hit: MatchRange,
  index: number,
  total: number
): { line: number; message: string } {
  const line = lineAtOffset(content, hit.start);
  return {
    line,
    message: `查找 ${index + 1}/${total} · 第 ${line} 行`,
  };
}
