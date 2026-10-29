/** CodeMirror 6 locate highlight: 朱砂 line (8%) + range mark (20%). */

import {
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";
import { clampDocPos } from "@/lib/locate/scrollSync";
import { safeCoordsAtPos } from "./safeCoords";

export type LocateHighlightSpec = {
  from: number;
  to: number;
  /** When false, only decorations (no selection change). Default true for decorations. */
  select?: boolean;
  focus?: boolean;
  center?: boolean;
};

export const setLocateHighlight = StateEffect.define<LocateHighlightSpec | null>();
export const clearLocateHighlight = StateEffect.define<null>();

const lineDeco = Decoration.line({ class: "lh-locate-line" });
const markDeco = Decoration.mark({ class: "lh-locate-mark" });

export const locateHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearLocateHighlight) || (e.is(setLocateHighlight) && e.value == null)) {
        return Decoration.none;
      }
      if (e.is(setLocateHighlight) && e.value) {
        const { from, to } = e.value;
        const doc = tr.state.doc;
        const f = clampDocPos(from, doc.length);
        const t = Math.max(f, clampDocPos(to, doc.length));
        const ranges = [];
        // Line highlights covering the range
        const startLine = doc.lineAt(f);
        const endLine = doc.lineAt(t === f ? f : Math.max(f, t - (t > f ? 1 : 0)));
        for (let ln = startLine.number; ln <= endLine.number; ln++) {
          const line = doc.line(ln);
          ranges.push(lineDeco.range(line.from));
        }
        if (t > f) {
          ranges.push(markDeco.range(f, t));
        }
        return Decoration.set(ranges, true);
      }
    }
    // Clear highlight if edited through the marked range heavily — map keeps it;
    // explicit clear on user doc change is handled by callers when needed.
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const locateHighlightTheme = EditorView.baseTheme({
  ".lh-locate-line": {
    backgroundColor: "rgba(179, 56, 42, 0.08)",
  },
  ".lh-locate-mark": {
    backgroundColor: "rgba(179, 56, 42, 0.20)",
    borderRadius: "2px",
  },
});

export function locateHighlightExtensions(): Extension[] {
  return [locateHighlightField, locateHighlightTheme];
}

/** Dispatch highlight (and optional select/focus/scroll). */
export function revealRangeInView(
  view: EditorView,
  from: number,
  to: number,
  opts: {
    center?: boolean;
    highlight?: boolean;
    select?: boolean;
    focus?: boolean;
    /** Always scroll to center — skip "already in view" short-circuit (split click locate). */
    forceScroll?: boolean;
  } = {}
) {
  const {
    center = true,
    highlight = true,
    select = false,
    focus = false,
    forceScroll = false,
  } = opts;
  const docLen = view.state.doc.length;
  const f = clampDocPos(from, docLen);
  const t = Math.max(f, clampDocPos(to, docLen));

  const effects = [];
  if (highlight) {
    effects.push(setLocateHighlight.of({ from: f, to: t }));
  }
  if (center) {
    // Only scroll if not already reasonably in view (safeCoords never throws)
    const coords = safeCoordsAtPos(view, f);
    const rect = view.scrollDOM.getBoundingClientRect();
    let needScroll = true;
    if (!forceScroll && coords) {
      const pad = 48;
      if (coords.top >= rect.top + pad && coords.bottom <= rect.bottom - pad) {
        needScroll = false;
      }
    }
    if (needScroll || forceScroll) {
      try {
        effects.push(EditorView.scrollIntoView(f, { y: "center" }));
      } catch {
        // ignore invalid scroll target during view/doc race
      }
    }
  }

  view.dispatch({
    selection: select ? { anchor: f, head: t } : undefined,
    effects,
  });

  // Manual center fallback: CM6 scrollIntoView can no-op after display:none → split
  // (stale geometry). Plain click locate uses forceScroll and has no selection cue.
  if (center && forceScroll) {
    const scroll = view.scrollDOM;
    const coords = safeCoordsAtPos(view, f);
    if (coords && scroll.clientHeight > 0) {
      const rect = scroll.getBoundingClientRect();
      const mid = (coords.top + coords.bottom) / 2;
      const next = scroll.scrollTop + (mid - rect.top) - rect.height / 2;
      if (Number.isFinite(next) && Math.abs(scroll.scrollTop - next) > 1) {
        scroll.scrollTop = next;
      }
    }
  }
  if (focus) view.focus();
}

export type PendingRevealLike = {
  start: number;
  end: number;
  select?: boolean;
  focus?: boolean;
  highlight?: boolean;
  center?: boolean;
};

/**
 * Apply pendingReveal after layout: view may be null on first paint, or scrollDOM
 * still 0-height after the source pane leaves `hidden`. Retries with rAF.
 */
export function scheduleRevealRangeInView(
  getView: () => EditorView | null,
  pending: PendingRevealLike,
  opts: {
    isCancelled: () => boolean;
    onBefore?: () => void;
    onDone: () => void;
    maxAttempts?: number;
  }
) {
  const maxAttempts = opts.maxAttempts ?? 24;
  const run = (attempt: number) => {
    if (opts.isCancelled()) return;
    const view = getView();
    if (!view) {
      if (attempt < maxAttempts) requestAnimationFrame(() => run(attempt + 1));
      return;
    }
    try {
      view.requestMeasure();
    } catch {
      /* ignore */
    }
    if (view.scrollDOM.clientHeight < 12 && attempt < maxAttempts) {
      requestAnimationFrame(() => run(attempt + 1));
      return;
    }
    opts.onBefore?.();
    revealRangeInView(view, pending.start, pending.end, {
      center: pending.center !== false,
      highlight: pending.highlight !== false,
      select: !!pending.select,
      focus: !!pending.focus,
      forceScroll: true,
    });
    opts.onDone();
  };
  // Double rAF: wait for flex layout after un-hiding the source pane.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => run(0));
  });
}

export function clearRevealInView(view: EditorView) {
  view.dispatch({ effects: clearLocateHighlight.of(null) });
}
