/**
 * Side annotations for Markdown preview — highlight + optional note,
 * stored separately from document body (never indexed as body text).
 */

import { uid } from "./utils";

export type AnnotationStatus = "active" | "stale";

export type Annotation = {
  id: string;
  docId: string;
  /** Document path snapshot when created (helps reanchor after renames). */
  path: string;
  /** Exact selected text snapshot (for display / reanchor). */
  quote: string;
  /** Optional user note. */
  note: string;
  /** Source offsets when known. */
  start: number;
  end: number;
  /** Plain/source caret offset at creation (usually === start). */
  plainOffset: number;
  /** Short context before/after quote for safe reanchor. */
  contextBefore: string;
  contextAfter: string;
  /**
   * 可选：创建时所在的最近一个标题（纯文本）。
   * 只用于「正文该不该高亮」的判断——标题都没了说明这一节被搬走或删了，
   * 再按偏移找就是瞎猜。旧数据没有这个字段，照常按 quote 走。
   */
  heading?: string;
  color: "cinnabar" | "gold" | "teal";
  status: AnnotationStatus;
  createdAt: number;
  updatedAt: number;
};

export type AnnotationInput = {
  docId: string;
  path?: string;
  quote: string;
  note?: string;
  start: number;
  end: number;
  plainOffset?: number;
  source?: string;
  color?: Annotation["color"];
  /** 创建时所在标题；由调用方从正文里推，缺省不带。 */
  heading?: string;
};

const CTX = 24;

function takeContext(source: string, start: number, end: number) {
  const before = source.slice(Math.max(0, start - CTX), start);
  const after = source.slice(end, Math.min(source.length, end + CTX));
  return { contextBefore: before, contextAfter: after };
}

/**
 * 某个源码偏移所在小节的标题（最近一个 `#`–`######` 行的纯文本）。
 *
 * 用行首匹配而不是 `extractOutline`：大纲只收 h1–h4，而批注落在 `#####`
 * 下也得有个归属。纯文本化的方式和 `outlineHeadingText` 保持一致。
 */
export function headingAtOffset(source: string, offset: number): string {
  if (!source) return "";
  const upto = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const lines = upto.split("\n");
  // 最后一行是光标所在行的前半截，可能正是一个标题本身。
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.+)$/.exec(lines[i]!);
    if (!m) continue;
    const text = m[1]!.replace(/[#*`]/g, "").trim();
    if (text) return text;
  }
  return "";
}

export function createAnnotation(input: AnnotationInput, now = Date.now()): Annotation {
  const quote = input.quote.trim();
  const start = Math.max(0, Math.min(input.start, input.end));
  const end = Math.max(start, input.end);
  const source = input.source || "";
  const ctx = source
    ? takeContext(source, start, end)
    : { contextBefore: "", contextAfter: "" };
  return {
    id: uid("ann"),
    docId: input.docId,
    path: input.path || "",
    quote,
    note: (input.note || "").trim(),
    start,
    end,
    plainOffset: input.plainOffset ?? start,
    contextBefore: ctx.contextBefore,
    contextAfter: ctx.contextAfter,
    ...(input.heading ? { heading: input.heading } : {}),
    color: input.color || "cinnabar",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function updateAnnotationNote(
  ann: Annotation,
  note: string,
  now = Date.now()
): Annotation {
  return { ...ann, note: note.trim(), updatedAt: now };
}

export function annotationsForDoc(list: Annotation[], docId: string): Annotation[] {
  return list
    .filter((a) => a.docId === docId)
    .sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);
}

export type RematchResult = {
  start: number;
  end: number;
  precision: "exact" | "reanchor" | "lost";
  /**
   * 只在 precision === "lost" 时出现，用来区分「改文导致失效」和「本来就没有」，
   * 好让 UI 说人话而不是一律「已失效」。
   */
  lostReason?: "quote-gone" | "ambiguous" | "heading-gone";
};

export type ReanchorSummary = {
  exact: number;
  reanchor: number;
  lost: number;
};

export function summarizeReanchor(results: RematchResult[]): ReanchorSummary {
  const out: ReanchorSummary = { exact: 0, reanchor: 0, lost: 0 };
  for (const r of results) {
    out[r.precision] += 1;
  }
  return out;
}

/**
 * Status bar copy; null when nothing drifted (all exact / empty).
 *
 * 批注失效是「正文改过了」的信号，用户需要知道 —— 但不能吓人：重锚成功的
 * 那几条此刻是准的，只有 lost 的那几条正文不再高亮。
 */
export function formatReanchorStatus(summary: ReanchorSummary): string | null {
  if (summary.reanchor === 0 && summary.lost === 0) return null;
  if (summary.lost === 0) {
    return `原文有改动，${summary.reanchor} 条批注已重新对齐`;
  }
  if (summary.reanchor === 0) {
    return `原文已变，${summary.lost} 条批注定位不准（只在侧栏保留）`;
  }
  return `原文已变：${summary.reanchor} 条已重新对齐，${summary.lost} 条定位不准（只在侧栏保留）`;
}

/** 单条批注失效时侧栏里的一句话。 */
export function annotationLostHint(reason?: RematchResult["lostReason"]): string {
  switch (reason) {
    case "ambiguous":
      return "原文有多处相同文字，无法确定位置 · 正文不再高亮";
    case "heading-gone":
      return "所在小节已改动或移走 · 正文不再高亮";
    default:
      return "原文已变，找不到这段文字 · 正文不再高亮";
  }
}

/**
 * Reanchor using offset + surrounding context.
 * Never falls back to a global first-indexOf of the quote (that drifts to wrong sentences).
 * Small edits near the original offset that keep unique context → reanchor.
 * Otherwise → lost (caller marks「已失效」).
 */
export function rematchAnnotation(source: string, ann: Annotation): RematchResult {
  const quote = ann.quote;
  if (!quote) {
    return { start: ann.start, end: ann.end, precision: "lost", lostReason: "quote-gone" };
  }

  if (
    ann.start >= 0 &&
    ann.end <= source.length &&
    ann.end > ann.start &&
    source.slice(ann.start, ann.end) === quote
  ) {
    return { start: ann.start, end: ann.end, precision: "exact" };
  }

  // Offset-centered window: prefer unique quote near original plainOffset/start.
  const pivot = Number.isFinite(ann.plainOffset) ? ann.plainOffset : ann.start;
  const window = 500;
  const from = Math.max(0, pivot - window);
  const to = Math.min(source.length, pivot + window + quote.length);
  const region = source.slice(from, to);

  const hits: number[] = [];
  let fromIdx = 0;
  while (fromIdx <= region.length) {
    const idx = region.indexOf(quote, fromIdx);
    if (idx < 0) break;
    hits.push(idx);
    fromIdx = idx + Math.max(1, quote.length);
  }

  if (hits.length === 1) {
    const start = from + hits[0]!;
    return { start, end: start + quote.length, precision: "reanchor" };
  }

  if (hits.length > 1) {
    // Disambiguate with contextBefore/contextAfter when available.
    const before = ann.contextBefore || "";
    const after = ann.contextAfter || "";
    const scored = hits
      .map((idx) => {
        const abs = from + idx;
        let score = 0;
        if (before) {
          const left = source.slice(Math.max(0, abs - before.length), abs);
          if (left === before) score += 2;
          else if (left.endsWith(before.slice(-Math.min(8, before.length)))) score += 1;
        }
        if (after) {
          const right = source.slice(abs + quote.length, abs + quote.length + after.length);
          if (right === after) score += 2;
          else if (right.startsWith(after.slice(0, Math.min(8, after.length)))) score += 1;
        }
        // Prefer closer to original pivot
        score -= Math.abs(abs - pivot) / 1000;
        return { abs, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (best && (!second || best.score > second.score + 0.5) && best.score >= 1) {
      return {
        start: best.abs,
        end: best.abs + quote.length,
        precision: "reanchor",
      };
    }
    // Ambiguous — do not guess wrong sentence
    return { start: ann.start, end: ann.end, precision: "lost", lostReason: "ambiguous" };
  }

  // Try exact context sandwich outside the local window once (still unique-only).
  if (ann.contextBefore || ann.contextAfter) {
    const needle = `${ann.contextBefore}${quote}${ann.contextAfter}`;
    if (needle.length > quote.length) {
      const i = source.indexOf(needle);
      if (i >= 0 && source.indexOf(needle, i + 1) < 0) {
        const start = i + ann.contextBefore.length;
        return { start, end: start + quote.length, precision: "reanchor" };
      }
    }
  }

  return { start: ann.start, end: ann.end, precision: "lost", lostReason: "quote-gone" };
}

/**
 * 标题锚校验：这条批注原来在某个标题下，现在那个标题还藏在文中吗？
 *
 * - 没有 `heading`（旧数据）→ 无从判断，放行，保持老行为；
 * - 标题已经不存在 → 这一节被整体删掉/改名了，偏移再怎么算都不可信 → 失效；
 * - 标题还在 → 正常。
 *
 * 只看「标题是否还在」，不要求 quote 落在它下面——把一段话挪到别的小节是
 * 正当编辑，不该因此判失效。
 */
export function headingStillPresent(source: string, ann: Annotation): boolean {
  const h = ann.heading;
  if (!h) return true;
  return new RegExp(`^#{1,6}\\s+[^\\n]*${escapeRe(h)}`, "m").test(source);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Combined verdict: quote rematch + heading anchor. */
export function rematchAnnotationWithAnchor(
  source: string,
  ann: Annotation
): RematchResult {
  // 先判锚：小节整体没了时，quote 也必然找不到，此时「小节没了」是更具体的
  // 解释，直接用它，别让用户以为是自己那几个字被改了。
  if (!headingStillPresent(source, ann)) {
    return {
      start: ann.start,
      end: ann.end,
      precision: "lost",
      lostReason: "heading-gone",
    };
  }
  return rematchAnnotation(source, ann);
}

/** Apply rematch into a new annotation object (marks stale when lost). */
export function resolveAnnotation(
  source: string,
  ann: Annotation,
  now = Date.now()
): Annotation {
  const m = rematchAnnotationWithAnchor(source, ann);
  if (m.precision === "lost") {
    if (ann.status === "stale") return ann;
    return { ...ann, status: "stale", updatedAt: now };
  }
  if (
    m.start === ann.start &&
    m.end === ann.end &&
    ann.status === "active"
  ) {
    return ann;
  }
  return {
    ...ann,
    start: m.start,
    end: m.end,
    plainOffset: m.start,
    status: "active",
    updatedAt: now,
  };
}

export function rewriteAnnotationsOnDocIdChange(
  list: Annotation[],
  fromId: string,
  toId: string
): Annotation[] {
  if (fromId === toId) return list;
  return list.map((a) => (a.docId === fromId ? { ...a, docId: toId } : a));
}

/** Fill fields missing from older persisted annotations. */
export function normalizeAnnotation(raw: Partial<Annotation> & Pick<Annotation, "id" | "docId" | "quote" | "start" | "end">): Annotation {
  const start = Math.max(0, Math.min(raw.start, raw.end));
  const end = Math.max(start, raw.end);
  return {
    id: raw.id,
    docId: raw.docId,
    path: raw.path || "",
    quote: raw.quote || "",
    note: raw.note || "",
    start,
    end,
    plainOffset: raw.plainOffset ?? start,
    contextBefore: raw.contextBefore || "",
    contextAfter: raw.contextAfter || "",
    // 旧数据没有这个字段：不补、不重置，保持「按 quote 匹配」的老行为。
    ...(raw.heading ? { heading: raw.heading } : {}),
    color: raw.color || "cinnabar",
    status: raw.status === "stale" ? "stale" : "active",
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}
