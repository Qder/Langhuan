import { lineAtOffset } from "./frontmatter";
import { normalizeNewlines } from "../utils";
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
  const { source: rawSource, text, before = "", after = "" } = opts;
  const source = normalizeNewlines(rawSource);
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

  // Noisy DOM selection: try shorter unique candidates in static HTML
  const candidates = buildSearchCandidates(sel);
  for (const needle of candidates) {
    if (needle === collapseHtmlWs(sel) || needle === sel.trim()) continue;
    const visIdx = visible.indexOf(needle);
    if (visIdx >= 0) {
      const start = map[visIdx];
      const end = map[Math.min(visIdx + needle.length, map.length - 1)];
      return {
        start,
        end,
        precision: "fuzzy",
        line: lineAtOffset(source, start),
        message: `已定位到第 ${lineAtOffset(source, start)} 行（部分匹配）`,
      };
    }
    const outIdx = findLiteralOutsideScriptStyle(source, needle);
    if (outIdx >= 0) {
      return {
        start: outIdx,
        end: outIdx + needle.length,
        precision: "fuzzy",
        line: lineAtOffset(source, outIdx),
        message: "位置可能不精确",
      };
    }
  }

  // Script/style-generated: locate the string literal that produced the DOM text
  const scriptHit = locateInScriptOrStyle(source, candidates.length ? candidates : [collapsedSel]);
  if (scriptHit) return scriptHit;

  return {
    start: 0,
    end: 0,
    precision: "none",
    message: "该内容由脚本生成，源码中没有对应文本",
  };
}

/** Prefer longest, distinctive substrings for fuzzy / script fallback. */
export function buildSearchCandidates(text: string): string[] {
  const collapsed = collapseHtmlWs(text);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = collapseHtmlWs(s);
    if (t.length < 4) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  push(collapsed);
  push(collapsed.replace(/[。．.！!？?；;：:\s]+$/u, ""));

  // Strip common badge / chrome prefixes that card clicks pick up
  push(collapsed.replace(/^(常用|进阶\/少用|已弃用|示例)\s*/u, ""));

  if (collapsed.length > 48) {
    push(collapsed.slice(0, 48));
    push(collapsed.slice(-48));
  }

  // Lines / sentence-like chunks
  for (const part of collapsed.split(/[\n\r]+|(?<=[。！？])\s*/u)) {
    push(part);
  }

  // CJK / word runs ≥ 6 chars, longest first after primary
  const runs = collapsed.match(/[\u4e00-\u9fff\u3400-\u4dbf]{6,}|[A-Za-z0-9_<>=/-]{8,}/g) || [];
  runs.sort((a, b) => b.length - a.length);
  for (const r of runs.slice(0, 8)) push(r);

  // Prefer longer needles first for uniqueness
  out.sort((a, b) => {
    if (a === collapsed) return -1;
    if (b === collapsed) return 1;
    return b.length - a.length;
  });
  return out;
}

function locateInScriptOrStyle(source: string, candidates: string[]): LocateResult | null {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = collapseHtmlWs(s);
    if (t.length < 4 || seen.has(t)) return;
    seen.add(t);
    expanded.push(t);
  };
  for (const c of candidates) {
    push(c);
    // Shrink from ends so noisy card text ("<h6>常用 六级…。示例") still hits the desc literal
    const t = collapseHtmlWs(c);
    for (let end = t.length - 1; end >= 6 && expanded.length < 60; end--) push(t.slice(0, end));
    for (let start = 1; start <= t.length - 6 && expanded.length < 100; start++) push(t.slice(start));
  }
  // Prefer longer matches
  expanded.sort((a, b) => b.length - a.length);

  // expanded is sorted longest-first; first hit is the best unique-ish match
  for (const needle of expanded) {
    const variants = [needle];
    const jsonBody = JSON.stringify(needle).slice(1, -1);
    if (jsonBody !== needle) variants.push(jsonBody);

    for (const v of variants) {
      const idx = findLiteralInsideScriptStyle(source, v);
      if (idx >= 0) {
        const line = lineAtOffset(source, idx);
        return {
          start: idx,
          end: idx + v.length,
          precision: "script",
          line,
          message: `脚本数据中的第 ${line} 行`,
        };
      }
    }
  }
  return null;
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

function findLiteralInsideScriptStyle(source: string, needle: string, from = 0): number {
  if (!needle) return -1;
  let start = from;
  while (start < source.length) {
    const idx = source.indexOf(needle, start);
    if (idx < 0) return -1;
    if (isInsideScriptOrStyle(source, idx)) return idx;
    start = idx + Math.max(1, needle.length);
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

/**
 * Locate a click that landed on a script-generated node (no data-lh on self).
 * Rules:
 * 1. Always have a container range (nearest annotated ancestor).
 * 2. Search script/JSON for clicked text:
 *    - unique match → that match + 「脚本数据中的第 N 行」
 *    - multiple → nearest to container + 「近似」
 *    - none → container only + 「内容由脚本生成，仅定位到所在容器」
 */
export function locateDynamicHtml(opts: {
  source: string;
  text: string;
  container: { start: number; end: number } | null;
}): LocateResult {
  const { source: rawSource, text, container } = opts;
  const source = normalizeNewlines(rawSource);
  const candidates = buildSearchCandidates(text || "");
  const needles = candidates.length
    ? candidates
    : [collapseHtmlWs(text || "")].filter((t) => t.length >= 4);

  type Hit = { start: number; end: number; needle: string };
  const allHits: Hit[] = [];

  for (const needle of needles) {
    const variants = [needle];
    const jsonBody = JSON.stringify(needle).slice(1, -1);
    if (jsonBody !== needle) variants.push(jsonBody);
    for (const v of variants) {
      let from = 0;
      while (from < source.length) {
        const idx = findLiteralInsideScriptStyle(source, v, from);
        if (idx < 0) break;
        allHits.push({ start: idx, end: idx + v.length, needle: v });
        from = idx + Math.max(1, v.length);
      }
    }
    if (allHits.length) break;
  }

  const containerLine = container ? lineAtOffset(source, container.start) : undefined;

  if (!allHits.length) {
    if (container) {
      return {
        start: container.start,
        end: container.end,
        precision: "container",
        line: containerLine,
        message: `内容由脚本生成，仅定位到所在容器（第 ${containerLine} 行）`,
      };
    }
    return {
      start: 0,
      end: 0,
      precision: "none",
      message: "内容由脚本生成，源码中没有对应文本",
    };
  }

  const uniqueStarts = new Map<number, Hit>();
  for (const h of allHits) {
    if (!uniqueStarts.has(h.start)) uniqueStarts.set(h.start, h);
  }
  const unique = [...uniqueStarts.values()];

  if (unique.length === 1) {
    const h = unique[0];
    const line = lineAtOffset(source, h.start);
    return {
      start: h.start,
      end: h.end,
      precision: "script",
      line,
      message: `脚本数据中的第 ${line} 行`,
    };
  }

  const origin = container?.start ?? 0;
  unique.sort((a, b) => Math.abs(a.start - origin) - Math.abs(b.start - origin));
  const h = unique[0];
  const line = lineAtOffset(source, h.start);
  return {
    start: h.start,
    end: h.end,
    precision: "fuzzy",
    line,
    message: `脚本生成，近似定位到第 ${line} 行`,
  };
}

