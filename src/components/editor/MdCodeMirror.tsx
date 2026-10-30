"use client";

import * as React from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { useStore } from "@/lib/store"
import { isDarkTheme } from "@/lib/theme";
import type { Document } from "@/lib/types";
import { titleOf, cn } from "@/lib/utils";
import { getDocMeta } from "@/lib/docMeta";
import { extractOutline } from "@/lib/outline";
import { htmlToMarkdown, looksLikeRichHtml } from "@/lib/htmlToMarkdown";
import {
  applySlashInsert,
  matchSlashCommand,
  type SlashCommand,
} from "@/lib/slashCommands";
import {
  SOURCE_SCROLL_UNFOLLOW_MS,
} from "@/lib/locate/scrollSync";
import {
  clearRevealInView,
  locateHighlightExtensions,
  scheduleRevealRangeInView,
} from "./locateHighlight";
import { safeCoordsAtPos, createRafScrollToOffset } from "./safeCoords";
import { subscribeScrollSync } from "@/lib/locate/scrollBus";
import { applyExternalDoc } from "@/lib/editorExternalSync";

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, o);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const col = o - (lastNl + 1) + 1;
  return { line, col };
}

export function MdCodeMirror({
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
  const setStatus = useStore((s) => s.setStatus);
  const setEditorCaret = useStore((s) => s.setEditorCaret);
  const viewMode = useStore((s) => s.viewMode);
  const documents = useStore((s) => s.documents);
  const ingestImageFile = useStore((s) => s.ingestImageFile);
  const theme = useStore((s) => s.theme);

  const [slash, setSlash] = React.useState<{
    top: number;
    left: number;
    items: SlashCommand[];
    index: number;
    start: number;
    end: number;
  } | null>(null);
  const [wiki, setWiki] = React.useState<{
    top: number;
    left: number;
    items: { label: string; insert: string }[];
    index: number;
    start: number;
  } | null>(null);
  const unfollowUntil = React.useRef(0);
  const applyingExternal = React.useRef(false);
  const ignoreScrollUntil = React.useRef(0);
  const machineDrive = React.useRef<"preview" | "editor" | null>(null);
  const resetTimer = React.useRef<number | null>(null);
  const cursorThrottle = React.useRef(0);
  const scrollPublishRaf = React.useRef(0);
  const rafScrollTo = React.useRef(createRafScrollToOffset());
  const publishScrollSync = useStore((s) => s.publishScrollSync);
  const getSyncScrollEnabled = useStore((s) => s.getSyncScrollEnabled);
  const readOnlyComp = React.useRef(new Compartment());
  const slashRef = React.useRef(slash);
  const wikiRef = React.useRef(wiki);
  React.useEffect(() => {
    slashRef.current = slash;
  }, [slash]);
  React.useEffect(() => {
    wikiRef.current = wiki;
  }, [wiki]);

  const content = getContent(doc.id);

  const refreshSuggest = React.useCallback(
    (view: EditorView) => {
      const caret = view.state.selection.main.head;
      const text = view.state.doc.toString();
      const slashMatch = matchSlashCommand(text, caret);
      if (slashMatch && slashMatch.items.length) {
        const coords = safeCoordsAtPos(view, slashMatch.start);
        setSlash({
          top: coords ? coords.bottom + 4 : 40,
          left: coords ? coords.left : 40,
          items: slashMatch.items,
          index: 0,
          start: slashMatch.start,
          end: slashMatch.end,
        });
        setWiki(null);
        return;
      }
      setSlash(null);

      const before = text.slice(0, caret);
      const m = before.match(/\[\[([^\]]*)$/);
      if (!m) {
        setWiki(null);
        return;
      }
      const q = m[1];
      const start = caret - q.length - 2;
      const items: { label: string; insert: string }[] = [];
      const hash = q.indexOf("#");
      if (hash >= 0) {
        const page = q.slice(0, hash).trim();
        const hPrefix = q.slice(hash + 1).toLowerCase();
        const target =
          documents.find((d) => titleOf(d.path) === page) ||
          documents.find((d) => getDocMeta(d).aliases.includes(page));
        if (target && target.type === "md") {
          for (const h of extractOutline(target.content)) {
            if (
              hPrefix &&
              !h.text.toLowerCase().includes(hPrefix) &&
              !h.id.includes(hPrefix)
            )
              continue;
            items.push({ label: `${page}#${h.text}`, insert: `${page}#${h.text}` });
          }
        }
      } else {
        const ql = q.toLowerCase();
        for (const d of documents) {
          if (d.type !== "md" && d.type !== "html") continue;
          const title = titleOf(d.path);
          const aliases = getDocMeta(d).aliases;
          const hay = [title, ...aliases, d.path].join("\n").toLowerCase();
          if (ql && !hay.includes(ql)) continue;
          items.push({ label: title, insert: title });
        }
      }
      const coords = safeCoordsAtPos(view, start);
      setWiki({
        top: coords ? coords.bottom + 4 : 40,
        left: coords ? coords.left : 40,
        items: items.slice(0, 12),
        index: 0,
        start,
      });
    },
    [documents]
  );

  React.useEffect(() => {
    if (!hostRef.current) return;
    const startDoc = getContent(doc.id);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal.current) {
        const next = update.state.doc.toString();
        setDraft(doc.id, next);
        clearRevealInView(update.view);
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const { line, col } = offsetToLineCol(update.state.doc.toString(), head);
        setEditorCaret({ line, col });
        refreshSuggest(update.view);
        if (update.selectionSet) {
          const now = Date.now();
          // Caret/click: claim drive briefly; hasFocus blocks inbound yank.
          // Do NOT set unfollowUntil — that mutes editor→preview scroll.
          machineDrive.current = "editor";
          ignoreScrollUntil.current = now + 150;
          if (resetTimer.current) window.clearTimeout(resetTimer.current);
          resetTimer.current = window.setTimeout(() => {
            machineDrive.current = null;
          }, 280);
          if (now - cursorThrottle.current > 100) {
            cursorThrottle.current = now;
            if (useStore.getState().viewMode !== "source") {
              requestPreviewLocate(head, { scroll: false, announce: false });
            }
          }
        }
      }
    });

    const scrollHandler = EditorView.domEventHandlers({
      scroll(_e, view) {
        // Cheapest gates first; posAtCoords only inside rAF (last-wins).
        if (useStore.getState().viewMode !== "split") return false;
        if (!useStore.getState().getSyncScrollEnabled(doc.id)) return false;
        const now = Date.now();
        if (now < ignoreScrollUntil.current) return false;
        if (now < unfollowUntil.current) return false;
        if (machineDrive.current === "preview") return false;
        machineDrive.current = "editor";
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => {
          machineDrive.current = null;
        }, 150);
        if (scrollPublishRaf.current) return false;
        scrollPublishRaf.current = requestAnimationFrame(() => {
          scrollPublishRaf.current = 0;
          const v = viewRef.current ?? view;
          if (useStore.getState().viewMode !== "split") return;
          if (!useStore.getState().getSyncScrollEnabled(doc.id)) return;
          const scroll = v.scrollDOM;
          const rect = scroll.getBoundingClientRect();
          const pos =
            v.posAtCoords({ x: rect.left + 8, y: rect.top + 8 }) ??
            v.state.selection.main.head;
          publishScrollSync({ docId: doc.id, from: "editor", sourceOffset: pos });
        });
        return false;
      },
    });

    const pasteHandler = EditorView.domEventHandlers({
      paste(event, view) {
        const cd = event.clipboardData;
        if (!cd) return false;
        const image = [...cd.items].find((it) => it.type.startsWith("image/"));
        if (image) {
          const file = image.getAsFile();
          if (file) {
            event.preventDefault();
            void (async () => {
              const res = await ingestImageFile(doc.id, file, file.name);
              if (!res) return;
              const pos = view.state.selection.main.head;
              view.dispatch({
                changes: { from: pos, to: pos, insert: res.snippet },
                selection: { anchor: pos + res.snippet.length },
              });
            })();
            return true;
          }
        }
        const html = cd.getData("text/html");
        if (html && looksLikeRichHtml(html)) {
          event.preventDefault();
          const md = htmlToMarkdown(html);
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: md },
            selection: { anchor: from + md.length },
          });
          setStatus("已将富文本转为 Markdown");
          return true;
        }
        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const imgs = [...files].filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void (async () => {
          let insertAt = pos;
          for (const f of imgs) {
            const res = await ingestImageFile(doc.id, f, f.name);
            if (!res) continue;
            const snippet = res.snippet + "\n";
            view.dispatch({
              changes: { from: insertAt, to: insertAt, insert: snippet },
            });
            insertAt += snippet.length;
          }
        })();
        return true;
      },
    });

    const customKeymap = keymap.of([
      {
        key: "Mod-Shift-Enter",
        run: (view) => {
          const offset = view.state.selection.main.head;
          if (useStore.getState().viewMode === "source") {
            useStore.getState().setViewMode("split");
          }
          machineDrive.current = "editor";
          unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
          ignoreScrollUntil.current = Date.now() + 200;
          requestPreviewLocate(offset, { scroll: true, announce: true });
          setStatus("已在预览中定位");
          return true;
        },
      },
      {
        key: "Mod-f",
        run: openSearchPanel,
      },
      {
        key: "ArrowDown",
        run: () => {
          const s = slashRef.current;
          if (s && s.items.length) {
            setSlash({ ...s, index: Math.min(s.items.length - 1, s.index + 1) });
            return true;
          }
          const w = wikiRef.current;
          if (w && w.items.length) {
            setWiki({ ...w, index: Math.min(w.items.length - 1, w.index + 1) });
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowUp",
        run: () => {
          const s = slashRef.current;
          if (s && s.items.length) {
            setSlash({ ...s, index: Math.max(0, s.index - 1) });
            return true;
          }
          const w = wikiRef.current;
          if (w && w.items.length) {
            setWiki({ ...w, index: Math.max(0, w.index - 1) });
            return true;
          }
          return false;
        },
      },
      {
        key: "Enter",
        run: (view) => {
          const slash = slashRef.current;
          const wiki = wikiRef.current;
          if (slash && slash.items[slash.index]) {
            applySlash(view, slash.items[slash.index], slash.start, slash.end);
            return true;
          }
          if (wiki && wiki.items[wiki.index]) {
            applyWiki(view, wiki.items[wiki.index], wiki.start);
            return true;
          }
          // list continuation
          const { state } = view;
          const line = state.doc.lineAt(state.selection.main.head);
          const m =
            line.text.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)$/) ||
            line.text.match(/^(\s*)>\s?(.*)$/);
          if (m) {
            const indent = m[1];
            if (line.text.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?$/)) {
              // empty list item → outdent / clear
              view.dispatch({
                changes: { from: line.from, to: line.to, insert: "" },
              });
              return true;
            }
            if (line.text.startsWith(indent + ">")) {
              const insert = `\n${indent}> `;
              const pos = state.selection.main.head;
              view.dispatch({
                changes: { from: pos, to: pos, insert },
                selection: { anchor: pos + insert.length },
              });
              return true;
            }
            const bullet = m[2];
            const check = m[3] || "";
            let nextBullet = bullet;
            if (/^\d+\.$/.test(bullet)) {
              nextBullet = `${parseInt(bullet, 10) + 1}.`;
            }
            const insert = `\n${indent}${nextBullet} ${check}`;
            const pos = state.selection.main.head;
            view.dispatch({
              changes: { from: pos, to: pos, insert },
              selection: { anchor: pos + insert.length },
            });
            return true;
          }
          return false;
        },
      },
      {
        key: "Tab",
        run: (view) => {
          const slash = slashRef.current;
          const wiki = wikiRef.current;
          if (slash && slash.items[slash.index]) {
            applySlash(view, slash.items[slash.index], slash.start, slash.end);
            return true;
          }
          if (wiki && wiki.items[wiki.index]) {
            applyWiki(view, wiki.items[wiki.index], wiki.start);
            return true;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          if (slashRef.current || wikiRef.current) {
            setSlash(null);
            setWiki(null);
            return true;
          }
          clearRevealInView(view);
          return false;
        },
      },
    ]);

    const themeExt = EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: "13px",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "inherit",
        },
        ".cm-content": {
          padding: "12px 8px",
          /* Tall bottom padding so clicks below the last line still place the caret
             and the user can continue writing at EOF without hunting a thin edge. */
          paddingBottom: "40vh",
          minHeight: "100%",
          caretColor: "var(--fg)",
        },
        ".cm-gutters": {
          background: "transparent",
          borderRight: "1px solid var(--border)",
          color: "var(--muted)",
        },
        ".cm-activeLine": {
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        },
        ".cm-activeLineGutter": {
          background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          color: "var(--accent)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
          background: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
        },
        ".cm-cursor": {
          borderLeftColor: "var(--accent)",
        },
        ".cm-searchMatch": {
          background: "color-mix(in srgb, var(--gold) 35%, transparent)",
        },
        ".cm-panels": {
          background: "var(--menu)",
          color: "var(--fg)",
          borderTop: "1px solid var(--border)",
        },
        ".cm-textfield": {
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
        },
        ".cm-button": {
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
        },
      },
      { dark: isDarkTheme(theme) }
    );

    const state = EditorState.create({
      doc: startDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        history(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        autocompletion(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        Prec.highest(customKeymap),
        updateListener,
        pasteHandler,
        scrollHandler,
        themeExt,
        EditorView.lineWrapping,
        ...locateHighlightExtensions(),
        readOnlyComp.current.of([]),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorCaret(null);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      if (scrollPublishRaf.current) {
        cancelAnimationFrame(scrollPublishRaf.current);
        scrollPublishRaf.current = 0;
      }
      rafScrollTo.current.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per doc
  }, [doc.id]);

  // Sync external draft changes (e.g. preview inline edit / discard).
  // Preserve caret; skip while IME is composing so CJK input is not aborted.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const tryApply = () => {
      applyingExternal.current = true;
      const result = applyExternalDoc(view, content);
      applyingExternal.current = false;
      return result;
    };
    const result = tryApply();
    if (result.applied === false && result.reason === "composing") {
      const onEnd = () => {
        // Re-read store: composition may have already synced via updateListener.
        applyingExternal.current = true;
        applyExternalDoc(view, useStore.getState().getContent(doc.id));
        applyingExternal.current = false;
      };
      view.contentDOM.addEventListener("compositionend", onEnd);
      return () => view.contentDOM.removeEventListener("compositionend", onEnd);
    }
  }, [content, doc.id]);

  // pending reveal — defer while preview-only (editor may be mounted but hidden).
  // After display:none → split, CM6 needs measure + rAF or scroll/highlight no-ops.
  React.useLayoutEffect(() => {
    if (!pendingReveal) return;
    if (viewMode === "preview") return;
    let cancelled = false;
    const pending = pendingReveal;
    scheduleRevealRangeInView(() => viewRef.current, pending, {
      isCancelled: () => cancelled,
      onBefore: () => {
        unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
        ignoreScrollUntil.current = Date.now() + 120;
      },
      onDone: () => {
        if (!cancelled) clearPendingReveal();
      },
    });
    return () => {
      cancelled = true;
    };
  }, [pendingReveal, clearPendingReveal, viewMode]);

  // Preview → editor anchor scroll sync (bus; no React re-render on scroll)
  React.useEffect(() => {
    return subscribeScrollSync((ev) => {
      if (ev.docId !== doc.id) return;
      if (ev.from !== "preview") return;
      if (!getSyncScrollEnabled(doc.id)) return;
      if (useStore.getState().viewMode !== "split") return;
      const view = viewRef.current;
      if (!view) return;
      if (Date.now() < unfollowUntil.current) return;
      if (machineDrive.current === "editor") return;
      if (view.hasFocus) return;
      machineDrive.current = "preview";
      ignoreScrollUntil.current = Date.now() + 100;
      if (ev.sourceOffset == null || !Number.isFinite(ev.sourceOffset)) return;
      // coordsAtPos can throw RangeError even after clamp (DocView race / EOF side).
      // rAF last-wins: many preview scroll events per frame → one editor scroll.
      rafScrollTo.current.schedule(view, ev.sourceOffset);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        machineDrive.current = null;
      }, 150);
    });
  }, [doc.id, getSyncScrollEnabled]);

  const applySlash = (
    view: EditorView,
    cmd: SlashCommand,
    start: number,
    end: number
  ) => {
    const text = view.state.doc.toString();
    const { text: next, caret } = applySlashInsert(text, { start, end, query: "", items: [] }, cmd);
    view.dispatch({
      changes: { from: 0, to: text.length, insert: next },
      selection: { anchor: caret },
    });
    setSlash(null);
  };

  const applyWiki = (
    view: EditorView,
    item: { insert: string },
    start: number
  ) => {
    const caret = view.state.selection.main.head;
    const text = view.state.doc.toString();
    const before = text.slice(0, start);
    const after = text.slice(caret);
    const next = `${before}[[${item.insert}]]${after.replace(/^\]\]?/, "")}`;
    const newCaret = before.length + item.insert.length + 4;
    view.dispatch({
      changes: { from: 0, to: text.length, insert: next },
      selection: { anchor: newCaret },
    });
    setWiki(null);
  };

  void viewMode;

  return (
    <div className={cn("relative h-full min-h-0 bg-[var(--bg-elevated)]", className)}>
      <div ref={hostRef} className="h-full min-h-0 lh-cm-host" />
      {slash && slash.items.length > 0 && (
        <div
          className="fixed z-40 max-h-64 w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--menu)] shadow-xl p-1"
          style={{ top: slash.top, left: Math.min(slash.left, window.innerWidth - 300) }}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            斜杠命令
          </div>
          {slash.items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs",
                i === slash.index
                  ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                  : "hover:bg-[var(--hover)]"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                const view = viewRef.current;
                if (view) applySlash(view, it, slash.start, slash.end);
              }}
            >
              <span>{it.label}</span>
              <span className="text-[var(--muted)] font-mono">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
      {wiki && wiki.items.length > 0 && (
        <div
          className="fixed z-40 max-h-56 w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--menu)] shadow-xl p-1"
          style={{ top: wiki.top, left: Math.min(wiki.left, window.innerWidth - 300) }}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            双链补全
          </div>
          {wiki.items.map((it, i) => (
            <button
              key={it.label + i}
              type="button"
              className={cn(
                "flex w-full rounded-lg px-2 py-1.5 text-left text-xs truncate",
                i === wiki.index
                  ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                  : "hover:bg-[var(--hover)]"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                const view = viewRef.current;
                if (view) applyWiki(view, it, wiki.start);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
