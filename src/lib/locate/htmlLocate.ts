import { lineAtOffset } from "./frontmatter";
import { normalizeNewlines } from "../utils";
import { isTrivialSelection } from "./mdLocate";
import { buildHtmlPlainMap, decodeEntities, findHtmlTagEnd } from "./htmlPlainMap";
import type { LocateResult } from "./types";
import {
  DEFAULT_MAX_RUN,
  pickTextRunBounds,
} from "./textRun";

export { DEFAULT_MAX_RUN, pickTextRunBounds } from "./textRun";

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
 * Match visible click text inside an annotated ancestor's raw slice.
 * Returns precision "none" when the text is not found in the slice
 * (caller should then try script search / container).
 * Never uses a full-document first indexOf.
 */
export function locateStaticInRange(opts: {
  source: string;
  text: string;
  container: { start: number; end: number };
  /** 1-based visible ordinal among equal texts in the slice (default 1). */
  occurrence?: number;
}): LocateResult {
  const source = normalizeNewlines(opts.source);
  const { start: c0, end: c1 } = opts.container;
  const slice = source.slice(c0, c1);
  const text = (opts.text || "").replace(/\u00a0/g, " ").trim();
  if (!text || c1 <= c0) {
    return { start: 0, end: 0, precision: "none", message: "" };
  }

  const { visible, map, rawVisible, rawMap } = buildHtmlVisibleMap(slice);
  const occ = Math.max(1, opts.occurrence ?? 1);

  const findOcc = (hay: string, needle: string, nth: number): number => {
    if (!needle) return -1;
    let from = 0;
    let seen = 0;
    while (from <= hay.length) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) return -1;
      seen += 1;
      if (seen === nth) return idx;
      from = idx + Math.max(1, needle.length);
    }
    return -1;
  };

  // Prefer raw-visible (preserves more spacing), then collapsed.
  let idx = findOcc(rawVisible, text, occ);
  if (idx >= 0) {
    const start = c0 + rawMap[idx];
    const endIdx = Math.min(idx + text.length, rawMap.length - 1);
    const end = c0 + rawMap[endIdx];
    const line = lineAtOffset(source, start);
    return {
      start,
      end: Math.max(end, start + text.length),
      precision: "exact",
      line,
      message: `已定位到第 ${line} 行`,
    };
  }

  const collapsedSel = collapseHtmlWs(text);
  idx = findOcc(visible, collapsedSel, occ);
  if (idx >= 0 && collapsedSel.length > 0) {
    const start = c0 + map[idx];
    const endIdx = Math.min(idx + collapsedSel.length, map.length - 1);
    const end = c0 + map[endIdx];
    const line = lineAtOffset(source, start);
    return {
      start,
      end: Math.max(end, start + 1),
      precision: "exact",
      line,
      message: `已定位到第 ${line} 行`,
    };
  }

  return { start: 0, end: 0, precision: "none", message: "" };
}

/* ------------------------------------------------------------------ *
 * Word-level locate (I1) + attribute fallback (I2)
 * ------------------------------------------------------------------ */

/** Longest unsegmented run returned for CJK / unspaced scripts. */
/**
 * Locate the word under the caret inside an annotated element.
 *
 * `plainOffset` comes from the bridge (`caretRangeFromPoint` → offset within the
 * element's rendered text). No text matching: the offset is mapped straight
 * through `buildHtmlPlainMap`, so duplicate texts and inline markup are non-issues.
 * Returns `precision: "none"` when the bridge did not supply an offset or the
 * element renders no text — callers then fall back to the tag-level behaviour.
 */
export function locateTextRunInRange(opts: {
  source: string;
  container: { start: number; end: number };
  plainOffset?: number;
  maxRun?: number;
}): LocateResult {
  const source = normalizeNewlines(opts.source);
  const { start: c0, end: c1 } = opts.container;
  const offset = opts.plainOffset;
  if (!(c1 > c0) || offset == null || !Number.isFinite(offset)) {
    return { start: 0, end: 0, precision: "none", message: "" };
  }

  const { plain, map, endMap } = buildHtmlPlainMap(source.slice(c0, c1));
  if (!plain) return { start: 0, end: 0, precision: "none", message: "" };

  const bounds = pickTextRunBounds(plain, offset, opts.maxRun ?? DEFAULT_MAX_RUN);
  if (!bounds) return { start: 0, end: 0, precision: "none", message: "" };

  const start = c0 + map[bounds.start];
  const end = c0 + endMap[bounds.end - 1];
  if (!(end > start)) return { start: 0, end: 0, precision: "none", message: "" };

  const line = lineAtOffset(source, start);
  return { start, end, precision: "exact", line, message: `已定位到第 ${line} 行` };
}

const ATTR_NAME_RX = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

function escapeRx(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate an attribute *value* in the source (`<img alt="折线图">`, `title`,
 * `aria-label`, …). Used when a click lands on an element that renders no text,
 * so there is nothing to match in the visible map.
 */
export function locateAttrValueInRange(opts: {
  source: string;
  container: { start: number; end: number } | null;
  attrName?: string;
  attrValue?: string;
  /** Element tag hint from the bridge; preferred when several tags match. */
  tag?: string;
}): LocateResult {
  const source = normalizeNewlines(opts.source);
  const name = String(opts.attrName || "").trim().toLowerCase();
  const value = String(opts.attrValue || "").trim();
  const container = opts.container;
  const none: LocateResult = { start: 0, end: 0, precision: "none", message: "" };
  if (!container || !(container.end > container.start)) return none;
  if (!ATTR_NAME_RX.test(name) || !value) return none;

  const slice = source.slice(container.start, container.end);
  const tagHint = (opts.tag || "").toLowerCase();
  const rx = new RegExp(
    `(?:^|[\\s"'])${escapeRx(name)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );

  let fallback: { start: number; end: number } | null = null;
  let i = 0;
  while (i < slice.length) {
    const lt = slice.indexOf("<", i);
    if (lt < 0) break;
    if (slice.startsWith("<!--", lt)) {
      const close = slice.indexOf("-->", lt + 4);
      i = close < 0 ? slice.length : close + 3;
      continue;
    }
    const next = slice[lt + 1];
    if (next === "/" || next === "!" || next === "?") {
      const close = findHtmlTagEnd(slice, lt + 1);
      i = close < 0 ? slice.length : close + 1;
      continue;
    }
    const gt = findHtmlTagEnd(slice, lt + 1);
    if (gt < 0) break;
    const tagText = slice.slice(lt, gt + 1);
    i = gt + 1;

    const m = rx.exec(tagText);
    if (!m) continue;
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    if (!raw) continue;
    if (raw !== value && decodeEntities(raw) !== value) continue;

    const eq = m[0].indexOf("=");
    const rel = eq < 0 ? m[0].indexOf(raw) : m[0].indexOf(raw, eq + 1);
    if (rel < 0) continue;
    const start = container.start + lt + m.index + rel;
    const end = start + raw.length;

    const tagName = /^<([a-zA-Z][\w:-]*)/.exec(tagText)?.[1]?.toLowerCase() ?? "";
    if (!tagHint || tagName === tagHint) {
      const line = lineAtOffset(source, start);
      return {
        start,
        end,
        precision: "exact",
        line,
        message: `已定位到第 ${line} 行（属性 ${name}）`,
      };
    }
    if (!fallback) fallback = { start, end };
  }

  if (fallback) {
    const line = lineAtOffset(source, fallback.start);
    return {
      start: fallback.start,
      end: fallback.end,
      precision: "exact",
      line,
      message: `已定位到第 ${line} 行（属性 ${name}）`,
    };
  }
  return none;
}

/**
 * Preview click routing:
 * 1. `plainOffset` known → word-level run inside the annotated element
 * 2. Else static match of visible text inside the slice → whole element range
 * 3. Else attribute value (img alt / title / aria-label) → exact value range
 * 4. Else script/JSON search (locateDynamicHtml)
 * 5. Else whole ancestor range + 「仅定位到所在容器」
 * `annotatedSelf` is for messaging only — not used for branching.
 */
export function locatePreviewClick(opts: {
  source: string;
  text: string;
  container: { start: number; end: number } | null;
  occurrence?: number;
  id?: string;
  tag?: string;
  /** Messaging only; when true and text trivial, may return the whole range. */
  annotatedSelf?: boolean;
  /** Caret offset inside the annotated element's rendered text (bridge). */
  plainOffset?: number;
  /** Attribute fallback when the clicked element renders no text. */
  attrName?: string;
  attrValue?: string;
}): LocateResult {
  const source = normalizeNewlines(opts.source);
  const text = (opts.text || "").replace(/\u00a0/g, " ");
  const container = opts.container;

  if (container) {
    if (typeof opts.plainOffset === "number") {
      const run = locateTextRunInRange({
        source,
        container,
        plainOffset: opts.plainOffset,
      });
      if (run.precision !== "none") return run;
    }

    const staticHit = locateStaticInRange({
      source,
      text,
      container,
      occurrence: opts.occurrence,
    });
    if (staticHit.precision !== "none") {
      // Click locate: validated the annotated element — select whole tag range
      // (验收: 点 h2 中字 → 源码选中该 h2 含标签, 误差 0).
      const line = lineAtOffset(source, container.start);
      return {
        start: container.start,
        end: container.end,
        precision: "exact",
        line,
        message: `已定位到第 ${line} 行`,
      };
    }
    // annotatedSelf is messaging-only — never skip script search / never pretend exact
    // for empty chrome clicks (blank → container fallback below with 仅定位到所在容器).
  }

  if (container && (opts.attrName || opts.attrValue)) {
    const byAttr = locateAttrValueInRange({
      source,
      container,
      attrName: opts.attrName,
      attrValue: opts.attrValue,
      tag: opts.tag,
    });
    if (byAttr.precision !== "none") return byAttr;
  }

  const dyn = locateDynamicHtml({
    source,
    text,
    container,
    occurrence: opts.occurrence,
    id: opts.id,
    tag: opts.tag,
  });
  if (dyn.precision !== "none") return dyn;

  if (container) {
    const line = lineAtOffset(source, container.start);
    return {
      start: container.start,
      end: container.end,
      precision: "container",
      line,
      message: `仅定位到所在容器（第 ${line} 行）`,
    };
  }
  return dyn;
}

/**
 * Locate text inside script/style (JSON/data arrays, etc.).
 * Multi-hit disambiguation: occurrence (1-based) or id/tag near the hit —
 * never "closest to container / #main".
 */
export function locateDynamicHtml(opts: {
  source: string;
  text: string;
  container: { start: number; end: number } | null;
  occurrence?: number;
  id?: string;
  tag?: string;
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
  // Stable document order (not distance-to-container).
  const unique = [...uniqueStarts.values()].sort((a, b) => a.start - b.start);

  let chosen: Hit | undefined;

  // 1) visible ordinal
  const occ = opts.occurrence;
  if (occ != null && occ >= 1 && occ <= unique.length) {
    chosen = unique[occ - 1];
  }

  // 2) id / tag token near the hit inside script
  if (!chosen && (opts.id || opts.tag)) {
    const tokens = [opts.id, opts.tag].filter(Boolean) as string[];
    for (const h of unique) {
      const window = source.slice(Math.max(0, h.start - 120), Math.min(source.length, h.end + 120));
      if (tokens.some((t) => t && window.includes(t))) {
        chosen = h;
        break;
      }
    }
  }

  // 3) unique → that one; else first in document order (ordinal 1) with fuzzy note
  if (!chosen) {
    chosen = unique[0];
  }

  const h = chosen;
  const line = lineAtOffset(source, h.start);
  if (unique.length === 1) {
    return {
      start: h.start,
      end: h.end,
      precision: "script",
      line,
      message: `脚本数据中的第 ${line} 行`,
    };
  }
  return {
    start: h.start,
    end: h.end,
    precision: occ != null && occ >= 1 && occ <= unique.length ? "script" : "fuzzy",
    line,
    message:
      occ != null && occ >= 1 && occ <= unique.length
        ? `脚本数据中的第 ${line} 行（第 ${occ} 处）`
        : `脚本生成，定位到第 ${line} 行（共 ${unique.length} 处，取第 ${unique.indexOf(h) + 1} 处）`,
  };
}

