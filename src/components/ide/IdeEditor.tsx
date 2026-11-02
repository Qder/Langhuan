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

export function IdeEditor({ path }: { path: string }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const langComp = React.useRef(new Compartment());
  const themeComp = React.useRef(new Compartment());
  const applying = React.useRef(false);

  const draft = useIdeStore((s) => s.tabs.find((t) => t.path === path)?.draft ?? "");
  const setDraft = useIdeStore((s) => s.setDraft);
  const saveFile = useIdeStore((s) => s.saveFile);
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

  return <div ref={hostRef} className={cn("h-full w-full overflow-hidden")} />;
}
