"use client";

import * as React from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { useIdeStore } from "@/lib/ide/store";
import { languageIdFromPath } from "@/lib/ide/language";
import { languageSupportFor } from "@/lib/ide/languageSupport";
import { isDarkTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  clearRevealInView,
  locateHighlightExtensions,
  revealRangeInView,
} from "@/components/editor/locateHighlight";

export function IdeEditor({ path }: { path: string }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const langComp = React.useRef(new Compartment());
  const themeComp = React.useRef(new Compartment());
  const applying = React.useRef(false);

  const draft = useIdeStore((s) => s.tabs.find((t) => t.path === path)?.draft ?? "");
  const setDraft = useIdeStore((s) => s.setDraft);
  const saveFile = useIdeStore((s) => s.saveFile);
  const setSelection = useIdeStore((s) => s.setSelection);
  const pendingReveal = useIdeStore((s) => s.pendingReveal);
  const clearPendingReveal = useIdeStore((s) => s.clearPendingReveal);
  const theme = useStore((s) => s.theme);
  const dark = isDarkTheme(theme);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveKey = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          void saveFile(path);
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: draft,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        saveKey,
        ...locateHighlightExtensions(),
        langComp.current.of([]),
        themeComp.current.of(
          EditorView.theme(
            {
              "&": {
                height: "100%",
                fontSize: "13px",
                backgroundColor: "var(--bg)",
                color: "var(--fg)",
              },
              ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace" },
              ".cm-gutters": {
                backgroundColor: "var(--chrome)",
                color: "var(--muted)",
                borderRight: "1px solid var(--chrome-border)",
              },
              "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
              ".cm-activeLine": { backgroundColor: "var(--hover)" },
            },
            { dark }
          )
        ),
        EditorView.updateListener.of((u) => {
          if (applying.current) return;
          if (u.docChanged) {
            setDraft(path, u.state.doc.toString());
          }
          if (u.selectionSet || u.docChanged) {
            const sel = u.state.selection.main;
            const doc = u.state.doc;
            if (sel.empty) {
              setSelection(null);
            } else {
              const fromLine = doc.lineAt(sel.from).number;
              const toLine = doc.lineAt(sel.to === sel.from ? sel.from : Math.max(sel.from, sel.to - 1)).number;
              setSelection({
                path,
                fromLine,
                toLine,
                text: doc.sliceString(sel.from, sel.to),
              });
            }
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    const langId = languageIdFromPath(path);
    void languageSupportFor(langId).then((ext) => {
      if (viewRef.current !== view) return;
      view.dispatch({
        effects: langComp.current.reconfigure(ext),
      });
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // External draft sync (discard / reopen)
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === draft) return;
    applying.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: draft },
    });
    applying.current = false;
  }, [draft]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeComp.current.reconfigure(
        EditorView.theme(
          {
            "&": {
              height: "100%",
              fontSize: "13px",
              backgroundColor: "var(--bg)",
              color: "var(--fg)",
            },
            ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace" },
            ".cm-gutters": {
              backgroundColor: "var(--chrome)",
              color: "var(--muted)",
              borderRight: "1px solid var(--chrome-border)",
            },
            "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
            ".cm-activeLine": { backgroundColor: "var(--hover)" },
          },
          { dark }
        )
      ),
    });
  }, [dark]);

  // pendingReveal → scroll + brief line highlight (compute offsets when view is ready)
  React.useEffect(() => {
    if (!pendingReveal || pendingReveal.path !== path) return;
    let cancelled = false;
    const reveal = pendingReveal;
    const maxAttempts = 24;
    const run = (attempt: number) => {
      if (cancelled) return;
      const view = viewRef.current;
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
      const lineCount = view.state.doc.lines;
      const startLine = Math.min(Math.max(1, reveal.line), lineCount);
      const endLine = Math.min(
        Math.max(startLine, reveal.endLine ?? reveal.line),
        lineCount
      );
      const from = view.state.doc.line(startLine).from;
      const to = view.state.doc.line(endLine).to;
      revealRangeInView(view, from, to, {
        center: true,
        highlight: true,
        select: false,
        focus: false,
        forceScroll: true,
      });
      clearPendingReveal();
      window.setTimeout(() => {
        const v = viewRef.current;
        if (v) clearRevealInView(v);
      }, 1600);
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => run(0));
    });
    return () => {
      cancelled = true;
    };
  }, [pendingReveal, path, clearPendingReveal]);

  return <div ref={hostRef} className={cn("h-full w-full overflow-hidden")} />;
}
