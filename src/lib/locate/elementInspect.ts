/**
 * 「元素检视」抽屉的 HTML 段：这个元素在源码里长什么样、在第几行。
 *
 * 三段（HTML / 样式 / 行为）共用一次点击，HTML 这一段是纯计算：
 * 元素身份来自 iframe（bridge 回传 tag/attrs），行号来自现有的 htmlLocate
 * （点内联标注 `data-lh` 的区间 → 精确；落到文字/属性匹配 → 推断）。
 * 算不出来就说算不出来，不拿「最像的那一行」凑数。
 */
import { lineAtOffset } from "./frontmatter";
import type { LocatePrecision, LocateResult } from "./types";

export type ElementAttr = { name: string; value: string };

/** 元素在源码里的位置。startLine 为 0 表示没定位到。 */
export type ElementSourceInfo = {
  file: string;
  /** 1-based；0 = 未定位 */
  startLine: number;
  endLine: number;
  precision: LocatePrecision;
  /** 一句人话：为什么是这个精度 */
  note: string;
};

export type ElementHtmlInfo = ElementSourceInfo & {
  tag: string;
  attrs: ElementAttr[];
};

/** 打开标签最多显示几个属性（超出的折叠成 `… +N`）。 */
export const MAX_MARKUP_ATTRS = 6;
const MAX_ATTR_VALUE = 80;
const MAX_ATTRS = 12;
const SKIP_ATTRS = new Set(["data-lh"]);

/**
 * bridge 回传的属性是「DOM 上直接读到的」：空白压平、超长截断、插桩属性丢掉。
 * 不接受任何非字符串，脏数据直接扔。
 */
export function normalizeAttrs(raw: unknown): ElementAttr[] {
  if (!Array.isArray(raw)) return [];
  const out: ElementAttr[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = (item as { name?: unknown }).name;
    const value = (item as { value?: unknown }).value;
    if (typeof name !== "string" || !name) continue;
    const key = name.toLowerCase();
    if (SKIP_ATTRS.has(key) || key.startsWith("data-lh-")) continue;
    const text = (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
    out.push({
      name: key,
      value: text.length > MAX_ATTR_VALUE ? `${text.slice(0, MAX_ATTR_VALUE)}…` : text,
    });
    if (out.length >= MAX_ATTRS) break;
  }
  return out;
}

function quoteAttr(value: string): string {
  return `"${value.replace(/"/g, "&quot;")}"`;
}

/**
 * 打开标签的样子：`<button id="btn" class="primary">`。
 * 属性超过 maxAttrs 时收尾成 `… +N`，免得一条 markup 把面板撑爆。
 */
export function formatOpenTag(
  tag: string,
  attrs: ElementAttr[],
  opts: { maxAttrs?: number } = {}
): string {
  const max = opts.maxAttrs ?? MAX_MARKUP_ATTRS;
  const name = (tag || "").toLowerCase() || "element";
  const shown = attrs.slice(0, max);
  const rest = attrs.length - shown.length;
  const parts = shown.map((a) => (a.value ? `${a.name}=${quoteAttr(a.value)}` : a.name));
  if (rest > 0) parts.push(`… +${rest}`);
  return `<${name}${parts.length ? ` ${parts.join(" ")}` : ""}>`;
}

function spanLines(source: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const last = to > from ? to - 1 : from;
  return { startLine: lineAtOffset(source, from), endLine: lineAtOffset(source, last) };
}

/**
 * 由「元素身份 + 定位结果」拼出 HTML 段。
 *
 * 优先级：`data-lh` 标注区间（精确：就是这段元素源码）> htmlLocate 的文字/属性匹配（可能推断）
 * > 未定位（脚本动态生成的元素，源码里没有对应行）。
 */
export function buildElementHtmlInfo(opts: {
  file: string;
  source: string;
  element: { tag: string; attrs?: ElementAttr[] } | null;
  /** 点到的元素在源码里的区间（bridge 的 data-lh 标注） */
  range?: { start: number; end: number } | null;
  /** 现有 htmlLocate 的结果 */
  located?: LocateResult | null;
}): ElementHtmlInfo | null {
  const { file, source, element } = opts;
  if (!element || !element.tag) return null;
  const attrs = normalizeAttrs(element.attrs);

  const range = opts.range;
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
    const { startLine, endLine } = spanLines(source, range.start, range.end);
    return {
      file,
      startLine,
      endLine,
      precision: "exact",
      note: "按元素标注（data-lh）定位到元素源码",
      tag: element.tag,
      attrs,
    };
  }

  const located = opts.located;
  if (located && located.precision !== "none" && located.end > located.start) {
    const { startLine, endLine } = spanLines(source, located.start, located.end);
    return {
      file,
      startLine,
      endLine,
      precision: located.precision,
      note:
        located.precision === "exact"
          ? "按元素文本定位到对应行"
          : "按文本 / 属性近似定位，可能只是元素里的一段",
      tag: element.tag,
      attrs,
    };
  }

  return {
    file,
    startLine: 0,
    endLine: 0,
    precision: "none",
    note: "源码里没定位到这个元素（多半是脚本动态生成的）",
    tag: element.tag,
    attrs,
  };
}

/** 位置文案：`index.html:42–44` / `index.html:42` / 空串。 */
export function formatElementLocation(
  file: string,
  startLine: number,
  endLine: number
): string {
  if (!file || !startLine) return "";
  if (endLine > startLine) return `${file}:${startLine}–${endLine}`;
  return `${file}:${startLine}`;
}

/** 精度标签（样式 / 行为两段也复用同一套说法）。 */
export function precisionLabel(precision: LocatePrecision): string {
  if (precision === "exact") return "精确";
  if (precision === "none") return "未定位";
  // block / container / script / fuzzy：都只能算推断
  return "推断";
}
