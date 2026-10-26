import { lineAtOffset } from "./frontmatter";
import { isTrivialSelection } from "./mdLocate";
import type { LocateResult } from "./types";

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Build visible-text → source index map, skipping script/style contents and tags.
 * Whitespace in source is collapsed to match DOM text (roughly).
 */
export function buildHtmlVisibleMap(source: string): {
  visible: string;
  map: number[];
  /** raw visible without collapse, for exact-ish matching */
  rawVisible: string;
  rawMap: number[];
} {
  const rawMap: number[] = [];
  let rawVisible = "";
  const n = source.length;
  let i = 0;

  const pushRaw = (idx: number, ch: string) => {
    rawMap.push(idx);
    rawVisible += ch;
  };

  while (i < n) {
    if (source[i] === "<") {
      const tagMatch = source.slice(i).match(/^<\/?\s*([a-zA-Z][\w:-]*)/);
      const tagName = tagMatch?.[1]?.toLowerCase() ?? "";
      const close = source.indexOf(">", i + 1);
      if (close === -1) {
        pushRaw(i, source[i]);
        i += 1;
        continue;
      }
      const isSelfClose = source[close - 1] === "/";
      i = close + 1;
      if (!isSelfClose && (tagName === "script" || tagName === "style" || tagName === "noscript")) {
        const re = new RegExp(`<\\/\\s*${tagName}\\s*>`, "i");
        const rest = source.slice(i);
        const m = rest.match(re);
        if (m && m.index != null) {
          i += m.index + m[0].length;
        } else {
          i = n;
        }
      }
      continue;
    }

    if (source[i] === "&") {
      const semi = source.indexOf(";", i + 1);
      if (semi !== -1 && semi - i < 12) {
        const body = source.slice(i + 1, semi);
        let decoded = "";
        if (body.startsWith("#x") || body.startsWith("#X")) {
          decoded = String.fromCodePoint(parseInt(body.slice(2), 16) || 0);
        } else if (body.startsWith("#")) {
          decoded = String.fromCodePoint(parseInt(body.slice(1), 10) || 0);
        } else {
          decoded = ENTITY_MAP[body.toLowerCase()] ?? `&${body};`;
        }
        // map first char of entity to entity start; subsequent decoded chars also to start
        for (let k = 0; k < decoded.length; k++) pushRaw(i, decoded[k]);
        i = semi + 1;
        continue;
      }
    }

    pushRaw(i, source[i]);
    i += 1;
  }
  rawMap.push(n);

  // collapsed visible (HTML whitespace collapse)
  const map: number[] = [];
  let visible = "";
  let j = 0;
  let lastWasSpace = true; // trim start
  while (j < rawVisible.length) {
    const ch = rawVisible[j];
    if (/[\s\u00a0]/.test(ch)) {
      if (!lastWasSpace) {
        map.push(rawMap[j]);
        visible += " ";
        lastWasSpace = true;
      }
      j += 1;
      continue;
    }
    map.push(rawMap[j]);
    visible += ch;
    lastWasSpace = false;
    j += 1;
  }
  // trim end space
  if (visible.endsWith(" ")) {
    visible = visible.slice(0, -1);
    map.pop();
  }
  map.push(n);

  return { visible, map, rawVisible, rawMap };
}

export function locateInHtml(opts: {
  source: string;
  text: string;
  before?: string;
  after?: string;
}): LocateResult {
  const { source, text, before = "", after = "" } = opts;
  const sel = text.replace(/\u00a0/g, " ");

  if (isTrivialSelection(sel)) {
    return { start: 0, end: 0, precision: "none", message: "请先选中一段文字" };
  }

  const { visible, map, rawVisible, rawMap } = buildHtmlVisibleMap(source);
  const collapsedSel = collapseHtmlWs(sel);

  // Context match: before + text + after in collapsed visible
  const ctx = collapseHtmlWs(before) + collapsedSel + collapseHtmlWs(after);
  if (ctx.length > collapsedSel.length) {
    const ctxIdx = visible.indexOf(ctx);
    if (ctxIdx >= 0) {
      const startVis = ctxIdx + collapseHtmlWs(before).length;
      const endVis = startVis + collapsedSel.length;
      const start = map[startVis];
      const end = map[Math.min(endVis, map.length - 1)];
      return {
        start,
        end,
        precision: "exact",
        line: lineAtOffset(source, start),
        message: `已定位到第 ${lineAtOffset(source, start)} 行`,
      };
    }
  }

  // text alone in collapsed
  const tIdx = visible.indexOf(collapsedSel);
  if (tIdx >= 0 && collapsedSel.length > 0) {
    // if multiple, prefer one near before context
    let idx = tIdx;
    if (before) {
      const b = collapseHtmlWs(before);
      let from = 0;
      let best = tIdx;
      let bestScore = -1;
      while (from < visible.length) {
        const i = visible.indexOf(collapsedSel, from);
        if (i < 0) break;
        const prefix = visible.slice(Math.max(0, i - b.length), i);
        const score = b && prefix.endsWith(b) ? 2 : b && prefix.includes(b.slice(-10)) ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
        from = i + 1;
      }
      idx = best;
    }
    const start = map[idx];
    const end = map[Math.min(idx + collapsedSel.length, map.length - 1)];
    return {
      start,
      end,
      precision: "exact",
      line: lineAtOffset(source, start),
      message: `已定位到第 ${lineAtOffset(source, start)} 行`,
    };
  }

  // raw (no collapse) exact
  const rawIdx = rawVisible.indexOf(sel);
  if (rawIdx >= 0) {
    const start = rawMap[rawIdx];
    const end = rawMap[Math.min(rawIdx + sel.length, rawMap.length - 1)];
    return {
      start,
      end,
      precision: "exact",
      line: lineAtOffset(source, start),
      message: `已定位到第 ${lineAtOffset(source, start)} 行`,
    };
  }

  // literal in source, but skip matches inside script/style
  const lit = findLiteralOutsideScriptStyle(source, sel);
  if (lit >= 0) {
    return {
      start: lit,
      end: lit + sel.length,
      precision: "fuzzy",
      line: lineAtOffset(source, lit),
      message: "位置可能不精确",
    };
  }

  return {
    start: 0,
    end: 0,
    precision: "none",
    message: "该内容由脚本生成，源码中没有对应文本",
  };
}

function findLiteralOutsideScriptStyle(source: string, needle: string): number {
  if (!needle) return -1;
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx < 0) return -1;
    if (!isInsideScriptOrStyle(source, idx)) return idx;
    from = idx + Math.max(1, needle.length);
  }
  return -1;
}

function isInsideScriptOrStyle(source: string, index: number): boolean {
  const before = source.slice(0, index);
  const scripts = [...before.matchAll(/<script\b[^>]*>/gi)];
  const scriptCloses = [...before.matchAll(/<\/script\s*>/gi)];
  if (scripts.length > scriptCloses.length) return true;
  const styles = [...before.matchAll(/<style\b[^>]*>/gi)];
  const styleCloses = [...before.matchAll(/<\/style\s*>/gi)];
  if (styles.length > styleCloses.length) return true;
  return false;
}

function collapseHtmlWs(s: string): string {
  return s.replace(/[\s\u00a0]+/g, " ").trim();
}
