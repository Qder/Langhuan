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
  opts: { center?: boolean; highlight?: boolean; select?: boolean; focus?: boolean } = {}
) {
  const {
    center = true,
    highlight = true,
    select = false,
    focus = false,
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
    if (coords) {
      const pad = 48;
      if (coords.top >= rect.top + pad && coords.bottom <= rect.bottom - pad) {
        needScroll = false;
      }
    }
    if (needScroll) {
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
  if (focus) view.focus();
}

export function clearRevealInView(view: EditorView) {
  view.dispatch({ effects: clearLocateHighlight.of(null) });
}
