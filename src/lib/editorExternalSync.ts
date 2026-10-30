/**
 * Apply an external document string to a CodeMirror 6 EditorView without
 * clobbering the caret more than necessary, and without interrupting IME.
 */
import { EditorSelection, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type ApplyExternalDocResult =
  | { applied: false; reason: "same" | "composing" | "no-view" }
  | { applied: true };

function clampOffset(n: number, len: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(len, Math.floor(n)));
}

/** Map current main selection onto a document of length `nextLen`. */
export function clampSelectionToDoc(
  anchor: number,
  head: number,
  nextLen: number
): EditorSelection {
  return EditorSelection.single(
    clampOffset(anchor, nextLen),
    clampOffset(head, nextLen)
  );
}

/**
 * Replace the whole document when `next` differs from the current doc.
 * - No-op when strings are equal.
 * - No-op while `view.composing` (CJK IME) so composition is not aborted.
 * - Preserves a clamped selection so the caret does not jump to 0.
 */
export function applyExternalDoc(
  view: EditorView | null | undefined,
  next: string
): ApplyExternalDocResult {
  if (!view) return { applied: false, reason: "no-view" };
  const cur = view.state.doc.toString();
  if (cur === next) return { applied: false, reason: "same" };
  if (view.composing) return { applied: false, reason: "composing" };

  const { anchor, head } = view.state.selection.main;
  const selection = clampSelectionToDoc(anchor, head, next.length);
  const spec: TransactionSpec = {
    changes: { from: 0, to: cur.length, insert: next },
    selection,
  };
  view.dispatch(spec);
  return { applied: true };
}
