/**
 * Format a source offset range as「L12」or「L12–L18」for hover strip.
 */
import { lineAtOffset } from "./frontmatter";

export function lineRangeLabel(
  source: string,
  start: number,
  end: number
): { startLine: number; endLine: number; label: string } {
  const s = Math.max(0, Math.min(start, source.length));
  const e = Math.max(s, Math.min(end, source.length));
  const startLine = lineAtOffset(source, s);
  // end is exclusive; last included char is at e-1 when e > s
  const endLine = e > s ? lineAtOffset(source, e - 1) : startLine;
  const label =
    endLine <= startLine ? `L${startLine}` : `L${startLine}–L${endLine}`;
  return { startLine, endLine, label };
}
