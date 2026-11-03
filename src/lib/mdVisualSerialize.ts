/**
 * Serialize a preview DOM block back to a Markdown source slice.
 * Preserves markers from originalSlice; only replaces visible text.
 * Never rebuilds the whole document — caller still uses replaceRange.
 */

import { trailingNewline } from "./mdInlineEdit";
import { parseWikiInner, wikiDisplayLabel } from "./wikilink";

/** DOM nodeType constants (avoid relying on global Node in node/vitest). */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export type VisualBlockType =
  | "heading"
  | "paragraph"
  | "listItem"
  | "blockquote"
  | "callout"
  | "code"
  | "mermaid"
  | "math"
  | "table"
  | "tableCell"
  | "unknown";

export type SerializeVisualArgs = {
  originalSlice: string;
  blockType: VisualBlockType;
  /** Rendered block element (heading / p / li / blockquote). */
  element: Element;
};

/** Classify a source slice for preview edit strategy. */
export function classifyMdBlock(slice: string): VisualBlockType {
  const t = slice.trimStart();
  if (/^\$\$/.test(t)) return "math";
  if (/^```\s*mermaid\b/i.test(t) || /^~~~\s*mermaid\b/i.test(t)) {
    return "mermaid";
  }
  if (/^```/.test(t) || /^~~~/.test(t)) return "code";
  if (/^#{1,6}(\s|$)/.test(t)) return "heading";
  // GFM table / cell: mdast cell ranges look like "| text " or "| text |"
  if (/^\|/.test(t)) {
    const core = t.replace(/\s+$/, "");
    if (!core.includes("\n")) {
      let body = core.slice(1);
      if (body.endsWith("|")) body = body.slice(0, -1);
      // One content segment → cell; internal pipes → whole row (source).
      if (!body.includes("|")) return "tableCell";
      return "table";
    }
    return "table";
  }
  if (/\n\|.+\|/.test(t)) return "table";
  if (/^>\s*\[!(tip|note|warn)\]/i.test(t)) return "callout";
  if (/^>/.test(t)) return "blockquote";
  if (/^(\s*)([-*+]|\d+[.)])(\s+)/.test(t)) return "listItem";
  return "paragraph";
}

/** Types that use contenteditable visual edit (not source textarea). */
export function isVisualEditableType(t: VisualBlockType): boolean {
  return (
    t === "heading" ||
    t === "paragraph" ||
    t === "listItem" ||
    t === "blockquote" ||
    t === "tableCell"
  );
}

/** Types that keep monospace source textarea. */
export function isSourceEditType(t: VisualBlockType): boolean {
  return (
    t === "code" ||
    t === "mermaid" ||
    t === "math" ||
    t === "table" ||
    t === "callout" ||
    t === "unknown"
  );
}

/** Plain fenced code (```/~~~) — seamless in-preview edit; not mermaid/math. */
export function isCodeFenceEditType(t: VisualBlockType): boolean {
  return t === "code";
}

/** Choose preview inline-edit mode for a classified block. */
export function previewBlockEditMode(
  blockType: VisualBlockType,
  mono: boolean
): "visual" | "code" | "source" {
  if (isVisualEditableType(blockType) && !mono) return "visual";
  if (isCodeFenceEditType(blockType)) return "code";
  return "source";
}

export type ParsedMarkdownFence = {
  /** Opening fence line without trailing newline, e.g. "```html". */
  openLine: string;
  ch: "`" | "~";
  fenceLen: number;
  /** Info string after fence markers (lang + optional meta). */
  info: string;
  /** First info token (language), may be "". */
  lang: string;
  /** Inner code body (no wrapping fences). */
  body: string;
  /** Closing fence line without trailing newline. */
  closeLine: string;
  /** Trailing newlines after the closing fence in the original slice. */
  trailingNl: string;
};

/**
 * Parse a fenced code slice (``` or ~~~). Null if shape is invalid.
 * Callers should classify mermaid separately — this only checks fence shape.
 */
export function parseMarkdownFence(slice: string): ParsedMarkdownFence | null {
  const trailingMatch = slice.match(/(\r?\n)*$/);
  const trailingNl = trailingMatch ? trailingMatch[0] : "";
  const core = trailingNl ? slice.slice(0, -trailingNl.length) : slice;
  const lines = core.split("\n");
  if (lines.length < 2) return null;
  const open = lines[0] ?? "";
  const om = open.match(/^(`{3,}|~{3,})(.*)$/);
  if (!om) return null;
  const fence = om[1]!;
  const ch = fence[0] as "`" | "~";
  const fenceLen = fence.length;
  const info = (om[2] ?? "").trim();
  let closeIdx = -1;
  for (let i = lines.length - 1; i >= 1; i--) {
    const line = lines[i] ?? "";
    if (ch === "`") {
      if (/^`{3,}\s*$/.test(line) && (line.match(/^`+/)?.[0].length ?? 0) >= fenceLen) {
        closeIdx = i;
        break;
      }
    } else if (/^~{3,}\s*$/.test(line) && (line.match(/^~+/)?.[0].length ?? 0) >= fenceLen) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 1) return null;
  const body = lines.slice(1, closeIdx).join("\n");
  const lang = (info.split(/\s+/)[0] ?? "") || "";
  return {
    openLine: open,
    ch,
    fenceLen,
    info,
    lang,
    body,
    closeLine: lines[closeIdx]!,
    trailingNl,
  };
}

/** Rebuild a fenced slice from parse + edited body (preserves open info / fence style). */
export function rebuildMarkdownFence(
  parsed: ParsedMarkdownFence,
  body: string
): string {
  const normalized = body.replace(/\r\n/g, "\n");
  // Ensure a newline before the closing fence when body is non-empty and lacks one.
  const needsNl =
    normalized.length > 0 && !normalized.endsWith("\n");
  return (
    parsed.openLine +
    "\n" +
    normalized +
    (needsNl ? "\n" : "") +
    parsed.closeLine +
    parsed.trailingNl
  );
}

/**
 * Map a caret offset in the full fence slice → offset inside the body.
 * Offsets on the open/close fence clamp to body start/end.
 */
export function fenceBodyOffsetFromSliceOffset(
  parsed: ParsedMarkdownFence,
  sliceOffset: number
): number {
  const openLen = parsed.openLine.length + 1; // + newline
  const bodyLen = parsed.body.length;
  if (sliceOffset <= openLen) return 0;
  const into = sliceOffset - openLen;
  if (into >= bodyLen) return bodyLen;
  return into;
}

/**
 * Pure serialize: originalSlice markers + element visible text → new slice.
 * Empty heading keeps ATX prefix + empty title (does not delete the line).
 */
export function serializeVisualBlock(args: SerializeVisualArgs): string {
  const { originalSlice, blockType, element } = args;
  switch (blockType) {
    case "heading":
      return serializeHeading(originalSlice, element);
    case "listItem":
      return serializeListItem(originalSlice, element);
    case "blockquote":
      return serializeBlockquote(originalSlice, element);
    case "paragraph":
      return serializeParagraph(originalSlice, element);
    case "tableCell":
      return serializeTableCell(originalSlice, element);
    default:
      // Safety: never invent MD for mono/unknown — caller should not visual-edit these.
      return originalSlice;
  }
}

/**
 * Serialize from live DOM structure (code/strong/em → md), ignoring whether
 * originalSlice still contains inline markers. Used when splitting a CE host
 * into left/right halves that no longer match the full original slice.
 */
export function serializeVisualDomHalf(
  blockType: VisualBlockType,
  element: Element,
  originalSlice: string
): string {
  if (blockType === "paragraph") {
    return serializeParagraphFromDom(originalSlice, element);
  }
  // Headings / lists / quotes still need marker prefixes from originalSlice.
  return serializeVisualBlock({ originalSlice, blockType, element });
}

// ─── table cell ────────────────────────────────────────────────────────────

export type ParsedTableCellSlice = {
  /** Leading "|" plus following spaces from the original slice. */
  prefix: string;
  /** Visible cell body (no surrounding pipes). */
  content: string;
  /** Trailing spaces, optional closing "|", and trailing newlines. */
  suffix: string;
};

/**
 * Parse a mdast-style table cell slice ("| text " or "| text |").
 * Returns null when the slice is not a single cell fragment.
 */
export function parseTableCellSlice(slice: string): ParsedTableCellSlice | null {
  const nl = trailingNewline(slice);
  const core = nl ? slice.slice(0, -nl.length) : slice;
  if (!core.startsWith("|")) return null;
  let body = core.slice(1);
  let trailingPipe = false;
  if (body.endsWith("|")) {
    trailingPipe = true;
    body = body.slice(0, -1);
  }
  // Multi-cell row — not a single cell.
  if (body.includes("|")) return null;
  const leadWs = body.match(/^\s*/)?.[0] ?? "";
  const trailWs = body.match(/\s*$/)?.[0] ?? "";
  const content = body.slice(leadWs.length, body.length - trailWs.length);
  return {
    prefix: "|" + leadWs,
    content,
    suffix: trailWs + (trailingPipe ? "|" : "") + nl,
  };
}

/** Escape pipes so edited cell text cannot break the GFM row. */
function escapeTableCellPipes(text: string): string {
  return text.replace(/\|/g, "&#124;");
}

function serializeTableCell(originalSlice: string, element: Element): string {
  const parsed = parseTableCellSlice(originalSlice);
  if (!parsed) return originalSlice;
  const visible = (element.textContent || "")
    .replace(/\u200b/g, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return parsed.prefix + escapeTableCellPipes(visible) + parsed.suffix;
}

// ─── heading ───────────────────────────────────────────────────────────────

function serializeHeading(originalSlice: string, element: Element): string {
  const nl = trailingNewline(originalSlice);
  const core = nl ? originalSlice.slice(0, -nl.length) : originalSlice;
  const m = core.match(/^(#{1,6})(\s*)/);
  if (!m) return originalSlice;

  const hashes = m[1]!;
  const ws = m[2] && m[2].length > 0 ? m[2] : " ";
  const after = core.slice(m[0].length);
  const trail = after.match(/^(.*?)( +#+)\s*$/);
  const trailingMarks = trail ? trail[2]! : "";

  // Visible title only — strip newlines browsers may insert.
  const visible = (element.textContent || "").replace(/\s*\n\s*/g, " ").trim();
  // Empty heading: keep prefix (and optional closing #), no body text.
  return hashes + ws + visible + trailingMarks + nl;
}

// ─── list item ─────────────────────────────────────────────────────────────

const LIST_FIRST =
  /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

/** Count top-level list markers in a slice (continuation lines do not count). */
export function countTopLevelListItems(slice: string): number {
  const core = slice.replace(/\r?\n$/, "");
  let n = 0;
  for (const line of core.split(/\r?\n/)) {
    if (LIST_FIRST.test(line)) n += 1;
  }
  return n;
}

function serializeListItem(originalSlice: string, element: Element): string {
  // Safety: a UL/OL-scoped originalSlice must never collapse to one "- …" line.
  // (Click/hover used to resolve empty-li chrome to the wrapper; blur/⌘S then
  // wiped sibling items like the z: line above 速记.)
  if (countTopLevelListItems(originalSlice) > 1) {
    return originalSlice;
  }
  const nl = trailingNewline(originalSlice);
  const core = nl ? originalSlice.slice(0, -nl.length) : originalSlice;
  const lines = core.split(/\r?\n/);
  const first = lines[0] ?? "";
  const m = first.match(LIST_FIRST);
  if (!m) {
    return serializeParagraph(originalSlice, element);
  }

  const indent = m[1]!;
  const marker = m[2]!;
  const afterMarkerWs = m[3]!;
  const task = m[4] || "";
  const prefix = indent + marker + afterMarkerWs + task;
  const contIndent =
    indent + " ".repeat(marker.length + afterMarkerWs.length + task.length);

  const visible = getListItemVisibleText(element);
  // If the item body had inline syntax on the first line, try to preserve via
  // a synthetic paragraph serialize of the content portion only.
  const firstBody = m[5] ?? "";
  const restOriginal = lines.slice(1).join("\n");

  let newBody: string;
  if (hasInlineSyntax(firstBody) || hasInlineSyntax(restOriginal)) {
    // Serialize from the li's content nodes (skip checkbox input).
    newBody = serializeListItemInline(element, firstBody + (restOriginal ? "\n" + restOriginal : ""));
  } else {
    newBody = visible;
  }

  const bodyLines = newBody.split(/\r?\n/);
  const outFirst = prefix + (bodyLines[0] ?? "");
  const outRest = bodyLines
    .slice(1)
    .map((l) => (l.length === 0 ? contIndent.replace(/\s+$/, "") || contIndent : contIndent + l))
    .join("\n");
  return (outRest ? outFirst + "\n" + outRest : outFirst) + nl;
}

function getListItemVisibleText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.textContent || "");
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === "input") return;
    if (tag === "ul" || tag === "ol") return; // nested list: leave for source-edit ideally
    if (tag === "br") {
      parts.push("\n");
      return;
    }
    for (const c of Array.from(e.childNodes)) walk(c);
  };
  for (const c of Array.from(el.childNodes)) walk(c);
  return parts.join("").replace(/^\s+/, "").replace(/\s+$/, "");
}

function serializeListItemInline(el: Element, originalBody: string): string {
  // Build a temporary walk over children excluding input / nested lists.
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      out += node.textContent || "";
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === "input" || tag === "ul" || tag === "ol") return;
    out += serializeInlineNode(e, originalBody, newInlineCtx(), true);
  };
  for (const c of Array.from(el.childNodes)) walk(c);
  const conserved = conserveMarkers(originalBody, out.trimStart());
  return conserved.replace(/^\s+/, "").replace(/\s+$/, "");
}

// ─── paragraph ─────────────────────────────────────────────────────────────

function hasInlineSyntax(slice: string): boolean {
  return /[*_`]|\[\[[^\]]*\]\]|\[[^\]]+\]\([^)]+\)|<[^>]+>|\$[^$\n]+\$/.test(
    slice
  );
}

function serializeParagraphFromDom(originalSlice: string, element: Element): string {
  const nl = trailingNewline(originalSlice) || "\n";
  const core = nl && originalSlice.endsWith(nl)
    ? originalSlice.slice(0, -nl.length)
    : originalSlice.replace(/\n$/, "");
  const ctx = newInlineCtx();
  let out = "";
  for (const c of Array.from(element.childNodes)) {
    out += serializeInlineNode(c, core || out, ctx, false);
  }
  if (core && hasInlineSyntax(core)) {
    out = conserveMarkers(core, out);
  }
  // Strip ZWSP placeholders (empty-split targets); keep truly empty as "".
  out = out.replace(/^\u200b+|\u200b+$/g, "");
  return out + nl;
}

function serializeParagraph(originalSlice: string, element: Element): string {
  const nl = trailingNewline(originalSlice);
  const core = nl ? originalSlice.slice(0, -nl.length) : originalSlice;

  // Prefer DOM walk when the live tree has inline elements (CE may have
  // introduced <strong>/<code> even if originalSlice markers drifted).
  if (
    hasInlineSyntax(core) ||
    element.querySelector?.("code, strong, b, em, i, a, del, s, .wiki-link, .katex, img, figure")
  ) {
    return serializeParagraphFromDom(originalSlice, element);
  }

  const visible = elementTextWithBreaks(element).replace(/^\u200b+|\u200b+$/g, "");
  return visible + nl;
}

function elementTextWithBreaks(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.textContent || "");
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const e = node as Element;
    if (e.tagName.toLowerCase() === "br") {
      parts.push("\n");
      return;
    }
    for (const c of Array.from(e.childNodes)) walk(c);
  };
  for (const c of Array.from(el.childNodes)) walk(c);
  return parts.join("");
}

type InlineCtx = {
  wikiUsed: Set<number>;
  mathUsed: Set<number>;
  /** 已还原过的图（按出现顺序对上源码里的 ![]()，图注不进源码）。 */
  imgUsed: Set<number>;
  /** 已还原过的 **…** / __…__ 起止下标，避免串位。 */
  strongUsed: Set<number>;
};

function newInlineCtx(): InlineCtx {
  return {
    wikiUsed: new Set<number>(),
    mathUsed: new Set<number>(),
    imgUsed: new Set<number>(),
    strongUsed: new Set<number>(),
  };
}

function serializeInlineNode(
  node: Node,
  originalSlice: string,
  ctx: InlineCtx,
  childrenOnly: boolean
): string {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType !== ELEMENT_NODE) return "";
  const e = node as Element;
  const tag = e.tagName.toLowerCase();

  if (tag === "br") return "\n";

  // KaTeX: never emit MathML — pull original $...$
  if (
    e.classList?.contains("katex") ||
    e.classList?.contains("katex-display") ||
    (tag === "span" && e.querySelector?.(".katex"))
  ) {
    return matchMathFromOriginal(e, originalSlice, ctx);
  }
  if (e.classList?.contains("katex-mathml") || e.classList?.contains("katex-html")) {
    return "";
  }

  // WikiLink renders as <button class="wiki-link">
  if (
    e.classList?.contains("wiki-link") ||
    (tag === "button" && e.classList?.contains("wiki-link"))
  ) {
    return matchWikiFromOriginal(e.textContent || "", originalSlice, ctx);
  }

  if (tag === "strong" || tag === "b") {
    const inner = serializeChildren(e, originalSlice, ctx);
    const kept = matchStrongFromOriginal(inner, originalSlice, ctx);
    if (kept) return kept;
    // New bold via Ctrl+B: CommonMark rejects `**|…` — insert WJ so it still parses.
    if (/^\p{P}/u.test(inner)) {
      return "**" + "\u2060" + inner + "**";
    }
    return "**" + inner + "**";
  }
  if (tag === "em" || tag === "i") {
    return "*" + serializeChildren(e, originalSlice, ctx) + "*";
  }
  if (tag === "code") {
    return "`" + (e.textContent || "") + "`";
  }
  if (tag === "a") {
    const href = e.getAttribute("href") || "";
    const text = e.textContent || "";
    if (!href) return text;
    return `[${text}](${href})`;
  }
  if (tag === "del" || tag === "s") {
    return "~~" + serializeChildren(e, originalSlice, ctx) + "~~";
  }

  // 图：源码里的 ![](...) 原样搬回来（预渲染时 src 可能被改写成 blob / URL，
  // 不能反过来拼）。图注是 alt 的呈现，不写回正文。
  // 刚粘贴的图带 data-lh-md-href，按该路径写回，避免丢图。
  if (tag === "img") return matchImageFromOriginal(e, originalSlice, ctx);
  if (tag === "figcaption") return "";

  // Generic wrapper (span, etc.): descend
  if (childrenOnly) {
    return serializeChildren(e, originalSlice, ctx);
  }
  return serializeChildren(e, originalSlice, ctx);
}

function serializeChildren(
  e: Element,
  originalSlice: string,
  ctx: InlineCtx
): string {
  let out = "";
  for (const c of Array.from(e.childNodes)) {
    out += serializeInlineNode(c, originalSlice, ctx, false);
  }
  return out;
}

/**
 * Prefer the exact original `**…**` / `__…__` marker so a bare click-blur does
 * not rewrite Typora-style `**|A|…**` (CommonMark-invalid but rehype-recovered).
 */
function matchStrongFromOriginal(
  inner: string,
  original: string,
  ctx: InlineCtx
): string | null {
  const re = /(\*\*|__)([\u200b\u2060]?)([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    if (ctx.strongUsed.has(m.index)) continue;
    const payload = (m[2] || "") + (m[3] || "");
    const payloadPlain = payload.replace(/[\u200b\u2060]/g, "");
    const innerPlain = inner.replace(/[\u200b\u2060]/g, "");
    if (payload === inner || payloadPlain === innerPlain) {
      ctx.strongUsed.add(m.index);
      return m[0];
    }
  }
  return null;
}

/**
 * 把 DOM 里的 <img> 对回源码里的 ![](...)，按出现顺序取下一个还没用过的。
 * 刚粘贴的图带 data-lh-md-href 时直接写回 markdown，避免丢图。
 */
function matchImageFromOriginal(
  el: Element,
  original: string,
  ctx: InlineCtx
): string {
  const stamped = el.getAttribute("data-lh-md-href");
  if (stamped) {
    const alt = (el.getAttribute("alt") || "").replace(/[[\]]/g, "");
    return `![${alt}](${stamped})`;
  }
  const re = /!\[[^\]]*\]\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    if (ctx.imgUsed.has(m.index)) continue;
    ctx.imgUsed.add(m.index);
    return m[0];
  }
  return "";
}

function matchWikiFromOriginal(
  label: string,
  original: string,
  ctx: InlineCtx
): string {
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  const trimmed = label.trim();
  while ((m = re.exec(original))) {
    if (ctx.wikiUsed.has(m.index)) continue;
    const parsed = parseWikiInner(m[1]!);
    const display = wikiDisplayLabel(parsed);
    if (display === trimmed || parsed.target === trimmed || parsed.alias === trimmed) {
      ctx.wikiUsed.add(m.index);
      return m[0];
    }
  }
  // Fallback: new wikilink from visible label
  return `[[${trimmed}]]`;
}

function matchMathFromOriginal(
  el: Element,
  original: string,
  ctx: InlineCtx
): string {
  const dataSrc =
    el.getAttribute("data-src") ||
    el.querySelector?.("[data-src]")?.getAttribute("data-src");
  if (dataSrc && /^\s*\$[\s\S]*\$\s*$/.test(dataSrc)) {
    return dataSrc.trim();
  }
  // Prefer annotation / aria; else scan original $...$
  const ann =
    el.querySelector?.('annotation[encoding="application/x-tex"]')
      ?.textContent ||
    el.querySelector?.(".katex-mathml annotation")?.textContent;
  const re = /\$([^$\n]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    if (ctx.mathUsed.has(m.index)) continue;
    if (!ann || m[1] === ann || (el.textContent || "").includes(m[1]!)) {
      ctx.mathUsed.add(m.index);
      return m[0];
    }
  }
  // If we have tex annotation, wrap it
  if (ann) return `$${ann}$`;
  return "";
}

/**
 * Marker conservation: if original had [[...]] / `...` / $...$ whose visible
 * payload still appears in the serialized output, force the exact original marker.
 */
function conserveMarkers(original: string, serialized: string): string {
  let out = serialized;
  const markers: { raw: string; visible: string }[] = [];

  const wikiRe = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(original))) {
    const parsed = parseWikiInner(m[1]!);
    markers.push({ raw: m[0], visible: wikiDisplayLabel(parsed) });
  }
  const codeRe = /`([^`]+)`/g;
  while ((m = codeRe.exec(original))) {
    markers.push({ raw: m[0], visible: m[1]! });
  }
  const mathRe = /\$([^$\n]+)\$/g;
  while ((m = mathRe.exec(original))) {
    markers.push({ raw: m[0], visible: m[1]! });
  }

  for (const { raw, visible } of markers) {
    if (out.includes(raw)) continue;
    // If visible text is still present but marker form drifted, try to restore.
    if (!visible || !out.includes(visible)) continue;
    // Common drift: [[target|alias]] became [[alias]]
    const looseWiki = `[[${visible}]]`;
    if (raw.startsWith("[[") && out.includes(looseWiki) && looseWiki !== raw) {
      out = out.replace(looseWiki, raw);
      continue;
    }
    // Drift: $tex$ lost dollars but tex string remains as plain — leave as-is
    // (user may have intentionally removed math). Only restore when an alternate
    // math-looking form exists.
  }
  return out;
}

// ─── blockquote ────────────────────────────────────────────────────────────

function serializeBlockquote(originalSlice: string, element: Element): string {
  const nl = trailingNewline(originalSlice);
  const core = nl ? originalSlice.slice(0, -nl.length) : originalSlice;

  // Detect quote prefix style from first line (`> ` vs `>`)
  const firstLine = core.split(/\r?\n/)[0] ?? "";
  const pref = firstLine.match(/^>(\s?)/);
  const gt = pref ? `>${pref[1] ?? " "}` : "> ";

  const paragraphs = element.querySelectorAll(":scope > p");
  let body: string;
  if (paragraphs.length > 0) {
    body = Array.from(paragraphs)
      .map((p) => {
        const sliceGuess = core; // inline against whole quote body
        if (hasInlineSyntax(core)) {
          const ctx = newInlineCtx();
          let s = "";
          for (const c of Array.from(p.childNodes)) {
            s += serializeInlineNode(c, sliceGuess, ctx, false);
          }
          return conserveMarkers(core, s);
        }
        return elementTextWithBreaks(p);
      })
      .join("\n");
  } else {
    body = (element.textContent || "").replace(/\s+$/, "");
  }

  const lines = body.split(/\r?\n/);
  const prefixed = lines.map((l) => (l.length ? gt + l : ">")).join("\n");
  return prefixed + nl;
}
