/**
 * Side annotations for Markdown preview — highlight + optional note,
 * stored separately from document body.
 */

import { uid } from "./utils";

export type Annotation = {
  id: string;
  docId: string;
  /** Exact selected text snapshot (for display / soft rematch). */
  quote: string;
  /** Optional user note. */
  note: string;
  /** Source offsets when known (may drift after edits). */
  start: number;
  end: number;
  color: "cinnabar" | "gold" | "teal";
  createdAt: number;
  updatedAt: number;
};

export type AnnotationInput = {
  docId: string;
  quote: string;
  note?: string;
  start: number;
  end: number;
  color?: Annotation["color"];
};

export function createAnnotation(input: AnnotationInput, now = Date.now()): Annotation {
  const quote = input.quote.trim();
  const start = Math.max(0, Math.min(input.start, input.end));
  const end = Math.max(start, input.end);
  return {
    id: uid("ann"),
    docId: input.docId,
    quote,
    note: (input.note || "").trim(),
    start,
    end,
    color: input.color || "cinnabar",
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

/**
 * Soft rematch: if exact [start,end) no longer equals quote, search nearby / whole doc.
 * Returns updated offsets or the original when not found.
 */
export function rematchAnnotation(
  source: string,
  ann: Annotation
): { start: number; end: number; precision: "exact" | "search" | "lost" } {
  const quote = ann.quote;
  if (!quote) return { start: ann.start, end: ann.end, precision: "lost" };
  if (
    ann.start >= 0 &&
    ann.end <= source.length &&
    source.slice(ann.start, ann.end) === quote
  ) {
    return { start: ann.start, end: ann.end, precision: "exact" };
  }
  // Prefer search near old start
  const window = 400;
  const from = Math.max(0, ann.start - window);
  const to = Math.min(source.length, ann.end + window);
  const near = source.slice(from, to);
  const nearIdx = near.indexOf(quote);
  if (nearIdx >= 0) {
    const start = from + nearIdx;
    return { start, end: start + quote.length, precision: "search" };
  }
  const global = source.indexOf(quote);
  if (global >= 0) {
    return { start: global, end: global + quote.length, precision: "search" };
  }
  return { start: ann.start, end: ann.end, precision: "lost" };
}

export function rewriteAnnotationsOnDocIdChange(
  list: Annotation[],
  fromId: string,
  toId: string
): Annotation[] {
  if (fromId === toId) return list;
  return list.map((a) => (a.docId === fromId ? { ...a, docId: toId } : a));
}
