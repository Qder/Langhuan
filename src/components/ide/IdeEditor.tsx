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
import {
  findMapperInterfaceForXml,
  findMapperXmlForMethod,
  findMethodDeclarationLine,
  javaTypeFqn,
  looksLikeMapperInterface,
  xmlMapperNamespace,
  xmlStatementIdAtOffset,
} from "@/lib/ide/mapperNav";
import {
  importSpecAtOffset,
  findExportLineOrNull,
  planTsImport,
} from "@/lib/ide/tsImports";
import { isDarkTheme } from "@/lib/theme";
import {
  captureSnippetToLibrary,
  captureStatusMessage,
} from "@/lib/ide/captureToLibrary";
import { useStore } from "@/lib/store";
import { SelectionExplainAction } from "./explain/SelectionExplainAction";
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
  /** 右击位置（1-based 行 / 0-based 列），供 XML id、import 说明符这类非标识符目标使用。 */
  line: number;
  column: number;
};

/**
 * F12 的输入：光标处的标识符 + 可选的 `receiver.`，再加上原始的「光标所在位置」
 * 上下文 —— 因为 MyBatis XML 的 `id="…"` 和 TS 的 import 说明符都不是标识符，
 * 只看 word 会漏掉它们。
 */
type GotoDefQuery = {
  word: string | null;
  receiver: string | null;
  /** 1-based 行号与行内偏移（0-based）。 */
  line: number;
  column: number;
};

/** 选区 / 光标 → F12 查询。选区优先用选中的单词。 */
function buildGotoDefQuery(view: EditorView): GotoDefQuery {
  const sel = view.state.selection.main;
  const at = sel.empty ? sel.head : sel.from;
  const line = view.state.doc.lineAt(at);
  const column = at - line.from;
  if (!sel.empty) {
    const picked = view.state.doc.sliceString(sel.from, sel.to).trim();
    const w =
      wordAtOffset(picked, 0) ??
      (picked.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? picked : null);
    return { word: w, receiver: null, line: line.number, column };
  }
  const hit = symbolAtOffset(line.text, column);
  return {
    word: hit?.word ?? null,
    receiver: hit?.receiver ?? null,
    line: line.number,
    column,
  };
}

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
    (query: GotoDefQuery | null) => void
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
            gotoDefRef.current(buildGotoDefQuery(view));
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
            const ctxLine = pos != null ? view.state.doc.lineAt(pos) : null;
            setCtxMenu({
              x: event.clientX,
              y: event.clientY,
              hasSelection: !sel.empty,
              word,
              receiver,
              line: ctxLine?.number ?? 1,
              column: ctxLine && pos != null ? pos - ctxLine.from : 0,
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
            const hit = symbolAtOffset(line.text, pos - line.from);
            gotoDefRef.current({
              word: hit?.word ?? null,
              receiver: hit?.receiver ?? null,
              line: line.number,
              column: pos - line.from,
            });
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

  /** 已知行号的跳转（XML id、import 目标、接口方法行）。 */
  const openAtLine = React.useCallback(
    async (targetPath: string, line: number) => {
      setDefCandidates(null);
      const ok = await openFile(targetPath, { line: Math.max(1, line) });
      if (!ok) setStatus(`打不开 ${targetPath}`);
      return ok;
    },
    [openFile, setStatus]
  );

  const runGotoDefinition = React.useCallback(
    async (query: GotoDefQuery | null) => {
      setCtxMenu(null);
      if (!session) {
        setStatus("先打开文件夹");
        return;
      }
      const bufContent =
        tabs.find((t) => t.path === path)?.draft ??
        viewRef.current?.state.doc.toString() ??
        "";
      const lines = bufContent.split("\n");
      const lineIndex = Math.min(
        Math.max(0, (query?.line ?? 1) - 1),
        Math.max(0, lines.length - 1)
      );
      const lineText = lines[lineIndex] ?? "";
      const column = query?.column ?? 0;
      const readBody = async (rel: string) => {
        const open = tabs.find((t) => t.path === rel)?.draft;
        if (open != null) return open;
        return readIdeFile(session, rel);
      };

      const index = await (async () => {
        let scanned = collectScannedFileIndex(children);
        if (scanned.length < 30) {
          scanned = await collectFileIndexWithOptionalBfs({
            session,
            children,
            listDir: listIdeDir,
          });
        }
        return scanned;
      })();

      const lowerPath = path.toLowerCase();
      const lang = languageIdFromPath(path);

      // A) MyBatis XML: 光标在 <select id="foo"> 上 → 接口的同名方法。
      //    这条只认 namespace，不认同名文件，避免跳到别的 Mapper 的 selectById。
      if (lowerPath.endsWith(".xml")) {
        const stmtId = xmlStatementIdAtOffset(lineText, column);
        const namespace = xmlMapperNamespace(bufContent);
        if (stmtId) {
          if (!namespace) {
            setStatus("这份 XML 没写 <mapper namespace>，无法确定对应接口（非 LSP）");
            return;
          }
          setStatus("正在查找 Mapper 接口…");
          const plan = await findMapperInterfaceForXml({
            namespace,
            statementId: stmtId,
            fileIndex: index,
            readFile: readBody,
          });
          if (plan.kind === "open") {
            await openAtLine(plan.path, plan.line);
            return;
          }
          if (plan.kind === "ambiguous") {
            setDefCandidates({ word: stmtId, paths: plan.candidates });
            setStatus(`未唯一命中：${plan.reason}（非 LSP）`);
            return;
          }
          setStatus(`未找到 ${stmtId} 的接口方法：${plan.reason}（非 LSP）`);
          return;
        }
      }

      // B) TS/JS: 光标在 import/export/require 的路径上 → 目标文件。
      //    只解析 ./ 与 ../；node_modules、路径别名一律明说做不到。
      if (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx") {
        const spec = importSpecAtOffset(lineText, column);
        if (spec) {
          const plan = planTsImport({ fromPath: path, spec: spec.spec, fileIndex: index });
          if (plan.kind === "open") {
            let body: string | null = null;
            try {
              body = await readBody(plan.path);
            } catch {
              body = null;
            }
            const importName =
              lineText
                .match(/^\s*(?:import|export)\s+(?:type\s+)?([A-Za-z_$][\w$]*)/)?.[1] ??
              lineText.match(/\{([^}]*)\}/)?.[1]?.split(",")[0]?.trim().split(/\s+as\s+/)[0]?.trim() ??
              null;
            const line =
              (body && importName && findExportLineOrNull(body, importName)) || 1;
            await openAtLine(plan.path, line);
            return;
          }
          setDefCandidates(null);
          if (plan.kind === "ambiguous") {
            setDefCandidates({ word: spec.spec, paths: plan.candidates });
            setStatus(`未唯一命中：${plan.reason}`);
            return;
          }
          setStatus(plan.reason);
          return;
        }
      }

      const word = query?.word ?? null;
      if (!word) {
        setStatus("光标处不是可跳转的名字（非 LSP 只支持标识符 / import 路径 / XML id）");
        return;
      }
      const receiver = query?.receiver ?? null;

      // C) Java Mapper 接口里的方法声明 → 同名 XML 语句 id。
      //    namespace 必须与接口的 package+类名完全一致才跳，否则宁可不跳。
      if (languageIdFromPath(path) === "java" && looksLikeMapperInterface(path, bufContent)) {
        if (findMethodDeclarationLine(bufContent, word) != null) {
          const fqn = javaTypeFqn(bufContent, path);
          if (fqn) {
            setStatus("正在查找对应的 XML 语句…");
            const plan = await findMapperXmlForMethod({
              mapperPath: path,
              mapperFqn: fqn,
              method: word,
              fileIndex: index,
              readFile: readBody,
            });
            if (plan.kind === "open") {
              await openAtLine(plan.path, plan.line);
              return;
            }
            if (plan.kind === "ambiguous") {
              setDefCandidates({ word, paths: plan.candidates });
              setStatus(`未唯一命中：${plan.reason}（非 LSP）`);
              return;
            }
            // XML 侧对不上：退回到「本文件里的方法行」，并把原因讲清楚。
            setStatus(`没有可跳的 XML：${plan.reason}（非 LSP）`);
            await openDefinition(path, word);
            return;
          }
        }
      }

      // D) 原有的文件名 / receiver 类型解析。
      let plan = planGotoDefinition({
        word,
        receiver,
        currentPath: path,
        fileIndex: index,
        currentContent: bufContent,
      });
      // Fallback: scan Mapper/Dao/xml (+ other java) for unique method / id=
      if (plan.kind === "miss") {
        setStatus("正在查找定义…");
        plan = await searchMethodDefinition({
          word,
          fileIndex: index,
          readFile: readBody,
        });
      }
      if (plan.kind === "miss") {
        setDefCandidates(null);
        setStatus(
          `未找到定义「${word}」：不是本工程唯一文件名，也没落到唯一的 Mapper 方法（非 LSP）`
        );
        return;
      }
      if (plan.kind === "candidates") {
        setDefCandidates({ word: plan.symbol, paths: plan.candidates });
        setStatus(`多个同名定义，请选择（${plan.candidates.length}）`);
        return;
      }

      // 调用点 / 文件名命中都停在 Java 方法行（定义本身）。XML 只在从接口出发时
      // 才是目标 —— 从调用点直接跳 XML 会让人丢失「接口在哪」这层结构。
      await openDefinition(plan.path, plan.symbol);
    },
    [session, children, path, tabs, setStatus, openDefinition, openAtLine]
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
      // 同一个构造器也用于 F12 键位，保证右键菜单 / 快捷键 / 面板三处行为一致。
      void runGotoDefinition(buildGotoDefQuery(view));
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
    const view = viewRef.current;
    if (!view) return;
    const range = view.state.selection.main;
    if (range.empty) return;
    setSelection({ path, text: view.state.doc.sliceString(range.from, range.to),
      fromLine: view.state.doc.lineAt(range.from).number,
      toLine: view.state.doc.lineAt(Math.max(range.from, range.to - 1)).number });
    requestExplainSelection();
  };

  const captureSelectionToSnippet = async () => {
    const view = viewRef.current;
    setCtxMenu(null);
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    const doc = view.state.doc;
    const fromLine = doc.lineAt(sel.from).number;
    const toLine = doc.lineAt(
      sel.to === sel.from ? sel.from : Math.max(sel.from, sel.to - 1)
    ).number;
    // Awaited: the 「已收入速记」status only appears once 速记.md is persisted.
    const result = await captureSnippetToLibrary({
      path,
      fromLine,
      toLine,
      text: doc.sliceString(sel.from, sel.to),
      lang: path.split(".").pop() ?? "",
    });
    setStatus(result.ok ? captureStatusMessage(result, "已收入速记") : result.message);
  };

  return (
    <div className={cn("relative h-full w-full overflow-hidden")}>
      <SelectionExplainAction path={path} onExplain={explainSelection} />
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
              void runGotoDefinition({
                word: ctxMenu.word,
                receiver: ctxMenu.receiver,
                line: ctxMenu.line,
                column: ctxMenu.column,
              })
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
            onClick={() => void captureSelectionToSnippet()}
          >
            收入速记
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
