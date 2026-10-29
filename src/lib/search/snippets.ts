/**
 * Snippet extraction by Unicode codepoint (avoids splitting surrogate pairs / emoji).
 */

export type SnippetMark = { start: number; end: number };

export type SnippetResult = {
  text: string;
  marks: SnippetMark[];
};

function codepoints(s: string): string[] {
  return [...s];
}

/**
 * Build a window of ~`radius` codepoints on each side of the first hit.
 * `marks` are offsets into the returned `text` (not the original field).
 */
export function buildSnippet(
  fieldText: string,
  terms: string[],
  radius = 40
): SnippetResult {
  const text = fieldText || "";
  const cps = codepoints(text);
  if (!terms.length || !text) {
    const slice = cps.slice(0, radius * 2).join("");
    return {
      text: slice + (cps.length > radius * 2 ? "…" : ""),
      marks: [],
    };
  }

  let hitStart = -1;
  let hitEnd = -1;
  let hitTerm = terms[0];
  for (const t of terms) {
    if (!t) continue;
    const idx = text.indexOf(t);
    if (idx >= 0) {
      hitStart = codepointIndex(text, idx);
      hitEnd = hitStart + codepoints(t).length;
      hitTerm = t;
      break;
    }
  }
  if (hitStart < 0) {
    const slice = cps.slice(0, radius * 2).join("");
    return {
      text: (cps.length > radius * 2 ? slice + "…" : slice),
      marks: [],
    };
  }

  const from = Math.max(0, hitStart - radius);
  const to = Math.min(cps.length, hitEnd + radius);
  let snippet = cps.slice(from, to).join("");
  if (from > 0) snippet = "…" + snippet;
  if (to < cps.length) snippet = snippet + "…";

  const ellipsisAdjust = from > 0 ? 1 : 0;
  const marks: SnippetMark[] = [];
  // Remap all term hits that fall inside the window
  const windowStartCp = from;
  const windowEndCp = to;
  const snCps = codepoints(snippet);
  for (const t of terms) {
    if (!t) continue;
    const tLen = codepoints(t).length;
    // find in original text, map into snippet
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const byteIdx = text.indexOf(t, searchFrom);
      if (byteIdx < 0) break;
      const cpIdx = codepointIndex(text, byteIdx);
      const cpEnd = cpIdx + tLen;
      if (cpEnd > windowStartCp && cpIdx < windowEndCp) {
        const start = Math.max(0, cpIdx - windowStartCp) + ellipsisAdjust;
        const end = Math.min(windowEndCp - windowStartCp, cpEnd - windowStartCp) + ellipsisAdjust;
        if (end > start && end <= snCps.length) {
          marks.push({ start, end });
        }
      }
      searchFrom = byteIdx + Math.max(t.length, 1);
    }
  }

  // merge overlapping marks
  marks.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SnippetMark[] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m.start <= last.end) {
      last.end = Math.max(last.end, m.end);
    } else {
      merged.push({ ...m });
    }
  }

  void hitTerm;
  return { text: snippet, marks: merged };
}

/** Byte offset → codepoint index. */
function codepointIndex(s: string, byteOffset: number): number {
  return [...s.slice(0, byteOffset)].length;
}
