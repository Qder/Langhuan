/**
 * Defensive CodeMirror coordinate / scroll helpers.
 *
 * `EditorView.coordsAtPos` can throw RangeError ("Index out of range") even when
 * the position is clamped to `state.doc.length` — e.g. when the DocView length
 * briefly lags the document (decoration/widget race), or at EOF with side=1.
 * Always go through these helpers for scroll-sync and reveal paths.
 */

import { EditorView } from "@codemirror/view";
import { clampDocPos, shouldUpdateScrollTop } from "@/lib/locate/scrollSync";

export type CoordsRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/** Safe coordsAtPos: clamp, prefer side -1 at EOF, try/catch + line-start fallback. */
export function safeCoordsAtPos(view: EditorView, pos: number): CoordsRect | null {
  const len = view.state.doc.length;
  const o = clampDocPos(pos, len);
  const side: -1 | 1 = o >= len && len > 0 ? -1 : 1;
  try {
    return view.coordsAtPos(o, side);
  } catch {
    // View/doc race or internal gap: try start of containing line.
  }
  if (len <= 0) return null;
  try {
    const line = view.state.doc.lineAt(o);
    return view.coordsAtPos(line.from, 1);
  } catch {
    return null;
  }
}

/**
 * Scroll the editor so `offset` (source doc pos) sits near the top of the viewport.
 * Never throws: falls back to scrollIntoView, then percent of scrollHeight.
 */
export function scrollEditorToSourceOffset(view: EditorView, offset: number): void {
  const len = view.state.doc.length;
  const o = clampDocPos(offset, len);
  const scroll = view.scrollDOM;
  const coords = safeCoordsAtPos(view, o);
  if (coords) {
    const rect = scroll.getBoundingClientRect();
    const next = scroll.scrollTop + (coords.top - rect.top) - 8;
    if (shouldUpdateScrollTop(scroll.scrollTop, next)) {
      scroll.scrollTop = next;
    }
    return;
  }
  try {
    view.dispatch({ effects: EditorView.scrollIntoView(o, { y: "start" }) });
    return;
  } catch {
    // ignore and use percent fallback
  }
  if (len <= 0) {
    scroll.scrollTop = 0;
    return;
  }
  const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const next = (o / len) * max;
  if (shouldUpdateScrollTop(scroll.scrollTop, next)) {
    scroll.scrollTop = next;
  }
}

/**
 * Last-wins requestAnimationFrame coalesce for scrollEditorToSourceOffset.
 * Scroll-sync can fire many times per frame; only the latest offset is applied.
 */
export function createRafScrollToOffset(): {
  schedule: (view: EditorView, offset: number) => void;
  cancel: () => void;
} {
  let raf = 0;
  let pendingView: EditorView | null = null;
  let pendingOffset = 0;
  return {
    schedule(view: EditorView, offset: number) {
      pendingView = view;
      pendingOffset = offset;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const v = pendingView;
        pendingView = null;
        if (v) scrollEditorToSourceOffset(v, pendingOffset);
      });
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pendingView = null;
    },
  };
}
