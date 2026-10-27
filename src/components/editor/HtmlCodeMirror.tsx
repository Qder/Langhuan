"use client";

import * as React from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SOURCE_SCROLL_UNFOLLOW_MS,
  scrollTopFromPercent,
  shouldUpdateScrollTop,
} from "@/lib/locate/scrollSync";
import {
  clearRevealInView,
  locateHighlightExtensions,
  revealRangeInView,
} from "./locateHighlight";
import { scrollEditorToSourceOffset } from "./safeCoords";

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, o);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const col = o - (lastNl + 1) + 1;
  return { line, col };
}

/** Approximate source offset at the top of the editor viewport. */
function topLineOffset(view: EditorView): number {
  const scroll = view.scrollDOM;
  const top = scroll.scrollTop + 4;
  const pos = view.posAtCoords({ x: scroll.getBoundingClientRect().left + 8, y: scroll.getBoundingClientRect().top + 8 });
  if (pos != null) return pos;
  try {
    return view.elementAtHeight(top).from;
  } catch {
    return 0;
  }
}


export function HtmlCodeMirror({
  doc,
  className,
}: {
  doc: Document;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const pendingReveal = useStore((s) => s.pendingReveal);
  const clearPendingReveal = useStore((s) => s.clearPendingReveal);
  const requestPreviewLocate = useStore((s) => s.requestPreviewLocate);
  const setEditorCaret = useStore((s) => s.setEditorCaret);
  const viewMode = useStore((s) => s.viewMode);
  const getSyncScrollEnabled = useStore((s) => s.getSyncScrollEnabled);
  const publishScrollSync = useStore((s) => s.publishScrollSync);
  const scrollSyncEvent = useStore((s) => s.scrollSyncEvent);
  const htmlScrollPercent = useStore((s) => s.htmlScrollPercent);

  const unfollowUntil = React.useRef(0);
  const applyingExternal = React.useRef(false);
  const ignoreScrollUntil = React.useRef(0);
  const machineDrive = React.useRef<"preview" | "editor" | null>(null);
  const resetTimer = React.useRef<number | null>(null);
  const readOnlyComp = React.useRef(new Compartment());
  const cursorThrottle = React.useRef(0);

  const content = getContent(doc.id);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const startDoc = useStore.getState().getContent(doc.id);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal.current) {
        const text = update.state.doc.toString();
        setDraft(doc.id, text);
        // Clear locate highlight when user edits
        clearRevealInView(update.view);
      }
      if (update.selectionSet) {
        const head = update.state.selection.main.head;
        const { line, col } = offsetToLineCol(update.state.doc.toString(), head);
        setEditorCaret({ line, col });
        // Caret/click: claim drive briefly. hasFocus also blocks inbound sync.
        // Do NOT set unfollowUntil here — that would mute editor→preview scroll.
        const now = Date.now();
        machineDrive.current = "editor";
        ignoreScrollUntil.current = now + 150;
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => {
          machineDrive.current = null;
        }, 280);
        if (now - cursorThrottle.current > 100) {
          cursorThrottle.current = now;
          if (useStore.getState().viewMode !== "source") {
            // Highlight only — never scrollToRange here (that wrote sparse #empty anchors back).
            requestPreviewLocate(head, { scroll: false, announce: false });
          }
        }
      }
    });

    const scrollHandler = EditorView.domEventHandlers({
      scroll: (_e, view) => {
        const now = Date.now();
        if (now < ignoreScrollUntil.current) return false;
        if (now < unfollowUntil.current) return false;
        if (!useStore.getState().getSyncScrollEnabled(doc.id)) return false;
        if (useStore.getState().viewMode !== "split") return false;
        if (machineDrive.current === "preview") return false;
        machineDrive.current = "editor";
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => {
          machineDrive.current = null;
        }, 150);
        const offset = topLineOffset(view);
        publishScrollSync({ docId: doc.id, from: "editor", sourceOffset: offset });
        return false;
      },
      keydown: (e, view) => {
        if (e.key === "Escape") {
          clearRevealInView(view);
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          const offset = view.state.selection.main.head;
          if (useStore.getState().viewMode === "source") {
            useStore.getState().setViewMode("split");
          }
          machineDrive.current = "editor";
          unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
          ignoreScrollUntil.current = Date.now() + 200;
          requestPreviewLocate(offset, { scroll: true, announce: true });
          return true;
        }
        return false;
      },
    });

    const state = EditorState.create({
      doc: startDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        dropCursor(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSelectionMatches(),
        html(),
        EditorView.lineWrapping,
        keymap.of([
          ...closeSafe(defaultKeymap),
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: "Mod-f",
            run: openSearchPanel,
          },
        ]),
        updateListener,
        scrollHandler,
        ...locateHighlightExtensions(),
        readOnlyComp.current.of([]),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            lineHeight: "1.55",
          },
          ".cm-content": { caretColor: "var(--accent)" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorCaret(null);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === content) return;
    applyingExternal.current = true;
    view.dispatch({ changes: { from: 0, to: cur.length, insert: content } });
    applyingExternal.current = false;
  }, [content]);

  // pending reveal
  React.useEffect(() => {
    if (!pendingReveal) return;
    const view = viewRef.current;
    if (!view) return;
    unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
    ignoreScrollUntil.current = Date.now() + 120;
    revealRangeInView(view, pendingReveal.start, pendingReveal.end, {
      center: pendingReveal.center !== false,
      highlight: pendingReveal.highlight !== false,
      select: !!pendingReveal.select,
      focus: !!pendingReveal.focus,
    });
    clearPendingReveal();
  }, [pendingReveal, clearPendingReveal]);

  // Preview → source: prefer anchor offset when coverage is good; else percent.
  React.useEffect(() => {
    if (!scrollSyncEvent) return;
    if (scrollSyncEvent.docId !== doc.id) return;
    if (scrollSyncEvent.from !== "preview") return;
    if (!getSyncScrollEnabled(doc.id)) return;
    if (viewMode !== "split") return;
    const view = viewRef.current;
    if (!view) return;
    if (Date.now() < unfollowUntil.current) return;
    if (machineDrive.current === "editor") return;
    // Never move the source viewport while the user is actively in the editor.
    if (view.hasFocus) return;

    machineDrive.current = "preview";
    ignoreScrollUntil.current = Date.now() + 100;
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      machineDrive.current = null;
    }, 150);

    const offset = scrollSyncEvent.sourceOffset;
    if (typeof offset === "number" && Number.isFinite(offset)) {
      scrollEditorToSourceOffset(view, offset);
      return;
    }

    const pct =
      typeof scrollSyncEvent.percent === "number"
        ? scrollSyncEvent.percent
        : htmlScrollPercent;
    if (typeof pct !== "number" || !Number.isFinite(pct)) return;
    const scroll = view.scrollDOM;
    const next = scrollTopFromPercent(pct, scroll.scrollHeight, scroll.clientHeight);
    if (shouldUpdateScrollTop(scroll.scrollTop, next)) {
      scroll.scrollTop = next;
    }
  }, [scrollSyncEvent, doc.id, getSyncScrollEnabled, viewMode, htmlScrollPercent]);

  // Safety net: lh-scroll percent alone (when anchors message gated/missing).
  React.useEffect(() => {
    if (viewMode !== "split") return;
    if (!getSyncScrollEnabled(doc.id)) return;
    if (Date.now() < unfollowUntil.current) return;
    if (machineDrive.current === "editor") return;
    // Prefer scrollSyncEvent path; only apply raw percent if no recent preview drive.
    const ev = useStore.getState().scrollSyncEvent;
    if (ev && ev.docId === doc.id && ev.from === "preview" && ev.nonce > Date.now() - 80) {
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    if (view.hasFocus) return;
    const scroll = view.scrollDOM;
    const next = scrollTopFromPercent(
      htmlScrollPercent,
      scroll.scrollHeight,
      scroll.clientHeight
    );
    if (!shouldUpdateScrollTop(scroll.scrollTop, next)) return;
    machineDrive.current = "preview";
    ignoreScrollUntil.current = Date.now() + 100;
    scroll.scrollTop = next;
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      machineDrive.current = null;
    }, 150);
  }, [htmlScrollPercent, viewMode, doc.id, getSyncScrollEnabled]);

  return (
    <div className={cn("relative h-full min-h-0 bg-[var(--bg-elevated)]", className)}>
      <div ref={hostRef} className="h-full min-h-0 lh-cm-host" />
    </div>
  );
}

function closeSafe<T>(arr: readonly T[]): T[] {
  return [...arr];
}
