import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { tags as t } from "@lezer/highlight";

export type SourceLanguage = "markdown" | "html";

type Props = {
  value: string;
  language: SourceLanguage;
  dark: boolean;
  onChange: (next: string) => void;
};

const lightHighlight = syntaxHighlighting(defaultHighlightStyle, {
  fallback: true,
});

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#c792ea" },
  { tag: t.heading, color: "#82aaff", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold", color: "#ffcb6b" },
  { tag: t.emphasis, fontStyle: "italic", color: "#c3e88d" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#80cbc4" },
  { tag: t.url, color: "#89ddff" },
  { tag: t.processingInstruction, color: "#89ddff" },
  { tag: t.meta, color: "#89ddff" },
  { tag: t.comment, color: "#546e7a", fontStyle: "italic" },
  { tag: t.string, color: "#c3e88d" },
  { tag: t.number, color: "#f78c6c" },
  { tag: t.bool, color: "#f78c6c" },
  { tag: t.null, color: "#f78c6c" },
  { tag: t.propertyName, color: "#ffcb6b" },
  { tag: t.attributeName, color: "#ffcb6b" },
  { tag: t.attributeValue, color: "#c3e88d" },
  { tag: t.tagName, color: "#f07178" },
  { tag: t.className, color: "#ffcb6b" },
  { tag: t.typeName, color: "#ffcb6b" },
  { tag: t.operator, color: "#89ddff" },
  { tag: t.punctuation, color: "#89ddff" },
  { tag: t.bracket, color: "#89ddff" },
  { tag: t.monospace, color: "#eeffff" },
  { tag: t.contentSeparator, color: "#82aaff" },
  { tag: t.labelName, color: "#f07178" },
  { tag: t.atom, color: "#f78c6c" },
  { tag: t.definition(t.variableName), color: "#82aaff" },
  { tag: t.variableName, color: "#eeffff" },
  { tag: t.special(t.variableName), color: "#f07178" },
]);

const darkHighlight = syntaxHighlighting(darkHighlightStyle, {
  fallback: true,
});

function chromeTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        color: "var(--ink)",
        backgroundColor: "var(--input-bg)",
        height: "100%",
        fontSize: "0.92rem",
        border: "1px solid var(--line)",
        borderRadius: "12px",
        overflow: "hidden",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
        lineHeight: "1.55",
      },
      ".cm-content": {
        caretColor: "var(--accent)",
        padding: "0.85rem 0",
        minHeight: "100%",
      },
      ".cm-line": {
        padding: "0 1rem 0 0.35rem",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-bg)",
        color: "var(--muted)",
        border: "none",
        borderRight: "1px solid var(--line)",
        minWidth: "3.2rem",
      },
      ".cm-gutterElement": {
        padding: "0 0.65rem 0 0.4rem",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--accent-soft)",
        color: "var(--accent)",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--hover)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "var(--active) !important",
        },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent)",
      },
      "&.cm-focused": {
        outline: "2px solid var(--accent)",
        outlineOffset: "-1px",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--accent-soft)",
        border: "none",
        color: "var(--accent)",
      },
    },
    { dark },
  );
}

function languageExtension(language: SourceLanguage): Extension {
  if (language === "html") {
    // html() nests CSS + JS highlighting by default
    return html();
  }
  return markdown({ htmlTagLanguage: html() });
}

function buildExtensions(
  language: SourceLanguage,
  dark: boolean,
  onChangeRef: MutableRefObject<(next: string) => void>,
  langComp: Compartment,
  themeComp: Compartment,
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    indentOnInput(),
    bracketMatching(),
    EditorView.lineWrapping,
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...foldKeymap]),
    langComp.of(languageExtension(language)),
    themeComp.of([chromeTheme(dark), dark ? darkHighlight : lightHighlight]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": { height: "100%", minHeight: "420px" },
      ".cm-scroller": { minHeight: "420px" },
    }),
  ];
}

export function SourceEditor({ value, language, dark, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: buildExtensions(
        language,
        dark,
        onChangeRef,
        langComp.current,
        themeComp.current,
      ),
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; language/dark/value synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langComp.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeComp.current.reconfigure([
        chromeTheme(dark),
        dark ? darkHighlight : lightHighlight,
      ]),
    });
  }, [dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="source-editor" ref={hostRef} />;
}

export default SourceEditor;
