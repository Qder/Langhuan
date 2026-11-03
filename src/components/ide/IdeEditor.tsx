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
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
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
import {
  collectFileIndexWithOptionalBfs,
  collectScannedFileIndex,
} from "@/lib/ide/explain";
import {
  findDefinitionLine,
  planGotoDefinition,
  searchMethodDefinition,
  symbolAtOffset,
  wordAtOffset,
} from "@/lib/ide/gotoDefinition";
import { IDE_FIND_EVENT, IDE_GOTO_DEF_EVENT } from "@/lib/ide/ideEvents";
import { listIdeDir, readIdeFile } from "@/lib/ide/ideFs";
import { isDarkTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  clearRevealInView,
  locateHighlightExtensions,
  revealRangeInView,
} from "@/components/editor/locateHighlight";

type CtxMenu = {
  x: number;
  y: number;
  hasSelection: boolean;
  word: string | null;
  receiver: string | null;
};

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
  const requestExplainSelection = useIdeStore((s) => s.requestExplainSelection);
  const session = useIdeStore((s) => s.session);
  const children = useIdeStore((s) => s.children);
  const tabs = useIdeStore((s) => s.tabs);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);
  const theme = useStore((s) => s.theme);
  const dark = isDarkTheme(theme);

  const [ctxMenu, setCtxMenu] = React.useState<CtxMenu | null>(null);
  const [defCandidates, setDefCandidates] = React.useState<
    { word: string; paths: string[] } | null
  >(null);
  const gotoDefRef = React.useRef<
    (query: { word: string; receiver: string | null } | null) => void
  >(() => {});

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const ideKeys = Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            void saveFile(path);
            return true;
          },
        },
        {
          key: "F12",
          run: (view) => {
            const sel = view.state.selection.main;
            let query: { word: string; receiver: string | null } | null = null;
            if (!sel.empty) {
              const picked = view.state.doc.sliceString(sel.from, sel.to).trim();
              const w =
                wordAtOffset(picked, 0) ??
                (picked.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? picked : null);
              query = w ? { word: w, receiver: null } : null;
            } else {
              const line = view.state.doc.lineAt(sel.head);
              query = symbolAtOffset(line.text, sel.head - line.from);
            }
            gotoDefRef.current(query);
            return true;
          },
        },
      ])
    );

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
        ideKeys,
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
        EditorView.domEventHandlers({
          contextmenu: (event, view) => {
            event.preventDefault();
            const sel = view.state.selection.main;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            let word: string | null = null;
            let receiver: string | null = null;
            if (pos != null) {
              const line = view.state.doc.lineAt(pos);
              const sym = symbolAtOffset(line.text, pos - line.from);
              if (sym) {
                word = sym.word;
                receiver = sym.receiver;
              }
            }
            if (!word && !sel.empty) {
              const picked = view.state.doc.sliceString(sel.from, sel.to).trim();
              word =
                wordAtOffset(picked, 0) ??
                (picked.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? picked : null);
            }
            setCtxMenu({
              x: event.clientX,
              y: event.clientY,
              hasSelection: !sel.empty,
              word,
              receiver,
            });
            return true;
          },
          click: (event, view) => {
            // VS Code: Ctrl/Cmd+Click; also keep Alt+Click.
            if (!(event.altKey || event.metaKey || event.ctrlKey)) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return true;
            const line = view.state.doc.lineAt(pos);
            gotoDefRef.current(symbolAtOffset(line.text, pos - line.from));
            return true;
          },
        }),
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

  React.useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const openDefinition = React.useCallback(
    async (targetPath: string, word: string) => {
      setDefCandidates(null);
      let body: string | null =
        tabs.find((t) => t.path === targetPath)?.draft ?? null;
      if (body == null && session) {
        try {
          body = await readIdeFile(session, targetPath);
        } catch {
          body = null;
        }
      }
      const line = findDefinitionLine(body ?? "", word);
      const ok = await openFile(targetPath, { line });
      if (!ok) setStatus(`打不开 ${targetPath}`);
    },
    [tabs, session, openFile, setStatus]
  );

  const runGotoDefinition = React.useCallback(
    async (query: { word: string; receiver: string | null } | null) => {
      setCtxMenu(null);
      if (!query?.word) {
        setStatus("找不到定义");
        return;
      }
      if (!session) {
        setStatus("先打开文件夹");
        return;
      }
      const word = query.word;
      const receiver = query.receiver;
      let index = collectScannedFileIndex(children);
      if (index.length < 30) {
        index = await collectFileIndexWithOptionalBfs({
          session,
          children,
          listDir: listIdeDir,
        });
      }
      const currentContent =
        tabs.find((t) => t.path === path)?.draft ??
        viewRef.current?.state.doc.toString() ??
        "";
      let plan = planGotoDefinition({
        word,
        receiver,
        currentPath: path,
        fileIndex: index,
        currentContent,
      });
      // Fallback: scan Mapper/Dao/xml (+ other java) for unique method / id=
      if (plan.kind === "miss") {
        setStatus("正在查找定义…");
        plan = await searchMethodDefinition({
          word,
          fileIndex: index,
          readFile: async (rel) => {
            const open = tabs.find((t) => t.path === rel)?.draft;
            if (open != null) return open;
            return readIdeFile(session, rel);
          },
        });
      }
      if (plan.kind === "miss") {
        setStatus("找不到定义");
        setDefCandidates(null);
        return;
      }
      if (plan.kind === "candidates") {
        setDefCandidates({ word: plan.symbol, paths: plan.candidates });
        setStatus(`多个同名定义，请选择（${plan.candidates.length}）`);
        return;
      }
      await openDefinition(plan.path, plan.symbol);
    },
    [session, children, path, tabs, setStatus, openDefinition]
  );

  React.useEffect(() => {
    gotoDefRef.current = (query) => {
      void runGotoDefinition(query);
    };
  }, [runGotoDefinition]);

  // Shell claims Mod+F / F12 in capture; editor opens CM find or resolves word.
  React.useEffect(() => {
    const onFind = () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openSearchPanel(view);
    };
    const onGoto = () => {
      const view = viewRef.current;
      if (!view) {
        setStatus("请先打开一个文件");
        return;
      }
      view.focus();
      const sel = view.state.selection.main;
      let query: { word: string; receiver: string | null } | null = null;
      if (!sel.empty) {
        const picked = view.state.doc.sliceString(sel.from, sel.to).trim();
        const w =
          wordAtOffset(picked, 0) ??
          (picked.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? picked : null);
        query = w ? { word: w, receiver: null } : null;
      } else {
        const line = view.state.doc.lineAt(sel.head);
        query = symbolAtOffset(line.text, sel.head - line.from);
      }
      void runGotoDefinition(query);
    };
    window.addEventListener(IDE_FIND_EVENT, onFind);
    window.addEventListener(IDE_GOTO_DEF_EVENT, onGoto);
    return () => {
      window.removeEventListener(IDE_FIND_EVENT, onFind);
      window.removeEventListener(IDE_GOTO_DEF_EVENT, onGoto);
    };
  }, [runGotoDefinition, setStatus]);

  const copySelection = () => {
    const view = viewRef.current;
    setCtxMenu(null);
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    const text = view.state.doc.sliceString(sel.from, sel.to);
    void navigator.clipboard?.writeText(text).catch(() => {
      /* ignore */
    });
  };

  const explainSelection = () => {
    setCtxMenu(null);
    requestExplainSelection();
  };

  return (
    <div className={cn("relative h-full w-full overflow-hidden")}>
      <div ref={hostRef} className={cn("h-full w-full overflow-hidden")} />
      {ctxMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[148px] rounded-lg border border-[var(--border)] bg-[var(--chrome)] shadow-lg py-1 font-ui text-sm"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenu.word}
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            )}
            onClick={() =>
              void runGotoDefinition(
                ctxMenu.word
                  ? { word: ctxMenu.word, receiver: ctxMenu.receiver }
                  : null
              )
            }
          >
            转到定义 (F12)
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenu.hasSelection}
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            )}
            onClick={explainSelection}
          >
            讲解选区
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenu.hasSelection}
            className={cn(
              "w-full text-left px-3 py-1.5 hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            )}
            onClick={copySelection}
          >
            复制
          </button>
        </div>
      )}
      {defCandidates && (
        <div
          className="absolute z-40 left-3 top-3 right-3 max-w-md rounded-xl border border-[var(--border)] bg-[var(--chrome)] shadow-xl p-2 font-ui text-sm"
          role="listbox"
          aria-label="转到定义候选"
        >
          <div className="flex items-center justify-between px-1 pb-1.5 text-xs text-[var(--muted)]">
            <span>选择定义（{defCandidates.word}）</span>
            <button
              type="button"
              className="hover:text-[var(--fg)]"
              onClick={() => setDefCandidates(null)}
            >
              关闭
            </button>
          </div>
          {defCandidates.paths.map((p) => (
            <button
              key={p}
              type="button"
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[var(--hover)] truncate"
              onClick={() => void openDefinition(p, defCandidates.word)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
