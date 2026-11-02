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
};

const CTX = 24;

function takeContext(source: string, start: number, end: number) {
  const before = source.slice(Math.max(0, start - CTX), start);
  const after = source.slice(end, Math.min(source.length, end + CTX));
  return { contextBefore: before, contextAfter: after };
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
};

/**
 * Reanchor using offset + surrounding context.
 * Never falls back to a global first-indexOf of the quote (that drifts to wrong sentences).
 * Small edits near the original offset that keep unique context → reanchor.
 * Otherwise → lost (caller marks「已失效」).
 */
export function rematchAnnotation(source: string, ann: Annotation): RematchResult {
  const quote = ann.quote;
  if (!quote) return { start: ann.start, end: ann.end, precision: "lost" };

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
    return { start: ann.start, end: ann.end, precision: "lost" };
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

  return { start: ann.start, end: ann.end, precision: "lost" };
}

/** Apply rematch into a new annotation object (marks stale when lost). */
export function resolveAnnotation(
  source: string,
  ann: Annotation,
  now = Date.now()
): Annotation {
  const m = rematchAnnotation(source, ann);
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
    color: raw.color || "cinnabar",
    status: raw.status === "stale" ? "stale" : "active",
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}
