import { buildMdPlainMap, collapseWs } from "./mdPlainMap";
import { lineAtOffset } from "./frontmatter";
import type { LocateResult, MdBlockRange } from "./types";

const PUNCT_ONLY = /^[\s\p{P}\p{S}]*$/u;

export function isTrivialSelection(text: string): boolean {
  const t = text.replace(/\u00a0/g, " ").trim();
  if (!t) return true;
  if (PUNCT_ONLY.test(t) && t.length <= 3) return true;
  return false;
}

export function locateInMarkdown(opts: {
  source: string;
  selectedText: string;
  /** Absolute offsets into full source for the start block */
  startBlock: MdBlockRange | null;
  endBlock: MdBlockRange | null;
  /** Character offset of selection start within the start block's rendered plain text */
  anchorPlainOffset?: number;
}): LocateResult {
  const { source, selectedText, startBlock, endBlock, anchorPlainOffset } = opts;
  const text = selectedText.replace(/\u00a0/g, " ");

  if (isTrivialSelection(text)) {
    return { start: 0, end: 0, precision: "none", message: "请先选中一段文字" };
  }

  if (startBlock) {
    const blockEnd = endBlock ?? startBlock;
    const rangeStart = startBlock.start;
    const rangeEnd = blockEnd.end;
    const slice = source.slice(rangeStart, rangeEnd);

    // Code fence: match exact text inside fence content
    const fence = slice.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/);
    if (fence) {
      const content = fence[1];
      const contentOffset = slice.indexOf("\n") + 1;
      const idx = findNth(content, text, pickOccurrence(content, text, anchorPlainOffset));
      if (idx >= 0) {
        const start = rangeStart + contentOffset + idx;
        const end = start + text.length;
        return exactResult(source, start, end);
      }
    }

    const { plain, map } = buildMdPlainMap(slice);
    const occ = pickOccurrence(plain, text, anchorPlainOffset);
    let idx = findNth(plain, text, occ);
    // also try collapsed whitespace match
    if (idx < 0) {
      const collapsedSel = collapseWs(text);
      const { collapsed, indexMap } = collapseWithMap(plain);
      const cIdx = collapsed.indexOf(collapsedSel);
      if (cIdx >= 0 && collapsedSel.length > 0) {
        const plainStart = indexMap[cIdx];
        const plainEnd = indexMap[cIdx + collapsedSel.length - 1] + 1;
        const start = rangeStart + map[plainStart];
        const end = rangeStart + map[plainEnd];
        return exactResult(source, start, end);
      }
    }

    if (idx >= 0) {
      const plainEnd = idx + text.length;
      const start = rangeStart + map[idx];
      const end = rangeStart + map[Math.min(plainEnd, map.length - 1)];
      return exactResult(source, start, end);
    }

    // Multi-block: map start in startBlock, end in endBlock
    if (endBlock && endBlock.start !== startBlock.start) {
      const startSlice = source.slice(startBlock.start, startBlock.end);
      const endSlice = source.slice(endBlock.start, endBlock.end);
      const sm = buildMdPlainMap(startSlice);
      const em = buildMdPlainMap(endSlice);
      // take from first char of selection in start plain to last in end plain — approximate by
      // finding longest prefix of text in start and suffix in end
      const prefix = longestPrefixIn(sm.plain, text);
      const suffix = longestSuffixIn(em.plain, text);
      if (prefix > 0 || suffix > 0) {
        const start = startBlock.start + sm.map[Math.max(0, sm.plain.indexOf(text.slice(0, prefix)))];
        const suf = text.slice(text.length - suffix);
        const sufIdx = em.plain.lastIndexOf(suf);
        const end =
          sufIdx >= 0
            ? endBlock.start + em.map[Math.min(sufIdx + suffix, em.map.length - 1)]
            : endBlock.end;
        if (start < end) {
          return {
            start,
            end,
            precision: "exact",
            line: lineAtOffset(source, start),
            message: `已定位到第 ${lineAtOffset(source, start)} 行`,
          };
        }
      }
      // fallback continuous range across blocks
      return {
        start: startBlock.start,
        end: endBlock.end,
        precision: "block",
        line: lineAtOffset(source, startBlock.start),
        message: "已定位到所在段落",
      };
    }

    // block-level fallback
    return {
      start: startBlock.start,
      end: startBlock.end,
      precision: "block",
      line: lineAtOffset(source, startBlock.start),
      message: "已定位到所在段落",
    };
  }

  // fuzzy full-doc search
  const fuzzy = fuzzyFind(source, text);
  if (fuzzy) {
    return {
      start: fuzzy.start,
      end: fuzzy.end,
      precision: "fuzzy",
      line: lineAtOffset(source, fuzzy.start),
      message: "位置可能不精确",
    };
  }

  return { start: 0, end: 0, precision: "none", message: "未能定位到源码位置" };
}

function exactResult(source: string, start: number, end: number): LocateResult {
  return {
    start,
    end,
    precision: "exact",
    line: lineAtOffset(source, start),
    message: `已定位到第 ${lineAtOffset(source, start)} 行`,
  };
}

function findNth(haystack: string, needle: string, nth: number): number {
  if (!needle) return -1;
  let from = 0;
  let found = -1;
  for (let i = 0; i <= nth; i++) {
    found = haystack.indexOf(needle, from);
    if (found < 0) return -1;
    from = found + Math.max(1, needle.length);
  }
  return found;
}

function pickOccurrence(haystack: string, needle: string, anchorPlainOffset?: number): number {
  if (anchorPlainOffset == null || !needle) return 0;
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    positions.push(i);
    from = i + Math.max(1, needle.length);
  }
  if (positions.length <= 1) return 0;
  // choose occurrence whose start is closest to anchor offset
  let best = 0;
  let bestDist = Infinity;
  positions.forEach((p, idx) => {
    const d = Math.abs(p - anchorPlainOffset);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  });
  return best;
}

function collapseWithMap(s: string): { collapsed: string; indexMap: number[] } {
  // maps collapsed index → original index
  const indexMap: number[] = [];
  let collapsed = "";
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (collapsed.length > 0 && collapsed[collapsed.length - 1] !== " ") {
        indexMap.push(Math.max(0, i - 1));
        collapsed += " ";
      }
      continue;
    }
    indexMap.push(i);
    collapsed += s[i];
    i += 1;
  }
  return { collapsed: collapsed.trim(), indexMap };
}

function longestPrefixIn(haystack: string, text: string): number {
  const max = Math.min(haystack.length, text.length);
  for (let len = max; len > 0; len--) {
    if (haystack.includes(text.slice(0, len))) return len;
  }
  return 0;
}

function longestSuffixIn(haystack: string, text: string): number {
  const max = Math.min(haystack.length, text.length);
  for (let len = max; len > 0; len--) {
    if (haystack.includes(text.slice(text.length - len))) return len;
  }
  return 0;
}

function fuzzyFind(source: string, text: string): { start: number; end: number } | null {
  const needle = collapseWs(text);
  if (!needle) return null;
  // search in stripped full doc
  const { plain, map } = buildMdPlainMap(source);
  const collapsedSel = needle;
  const { collapsed, indexMap } = collapseWithMap(plain);
  const cIdx = collapsed.indexOf(collapsedSel);
  if (cIdx >= 0) {
    const plainStart = indexMap[cIdx];
    const plainEnd = indexMap[Math.min(cIdx + collapsedSel.length - 1, indexMap.length - 1)] + 1;
    return { start: map[plainStart], end: map[Math.min(plainEnd, map.length - 1)] };
  }
  const idx = source.indexOf(text);
  if (idx >= 0) return { start: idx, end: idx + text.length };
  return null;
}
