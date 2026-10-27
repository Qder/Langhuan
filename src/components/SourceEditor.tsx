"use client";

import * as React from "react";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import { htmlToMarkdown, looksLikeRichHtml } from "@/lib/htmlToMarkdown";
import {
  scrollTopFromPercent,
  SOURCE_SCROLL_UNFOLLOW_MS,
} from "@/lib/locate/scrollSync";
import { cn, titleOf } from "@/lib/utils";
import { extractOutline } from "@/lib/outline";
import { getDocMeta } from "@/lib/docMeta";
import { MdCodeMirror } from "./editor/MdCodeMirror";

hljs.registerLanguage("xml", xml);

function measureOffsetTop(ta: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.left = "-99999px";
  mirror.style.top = "0";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  const before = ta.value.slice(0, Math.max(0, offset));
  mirror.textContent = before.endsWith("\n") ? before + "\u00a0" : before;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);
  return top;
}

function measureRange(ta: HTMLTextAreaElement, start: number, end: number) {
  const top = measureOffsetTop(ta, start);
  const bottom = measureOffsetTop(ta, Math.max(start, end));
  const style = getComputedStyle(ta);
  const lineH = parseFloat(style.lineHeight) || 24;
  return { top, height: Math.max(lineH, bottom - top + lineH) };
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, o);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const col = o - (lastNl + 1) + 1;
  return { line, col };
}

function lineStartOffset(text: string, line1: number): number {
  if (line1 <= 1) return 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      line += 1;
      if (line === line1) return i + 1;
    }
  }
  return text.length;
}

export function SourceEditor({
  doc,
  className,
}: {
  doc: Document;
  className?: string;
}) {
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const pendingReveal = useStore((s) => s.pendingReveal);
  const clearPendingReveal = useStore((s) => s.clearPendingReveal);
  const requestPreviewLocate = useStore((s) => s.requestPreviewLocate);
  const setStatus = useStore((s) => s.setStatus);
  const setEditorCaret = useStore((s) => s.setEditorCaret);
  const viewMode = useStore((s) => s.viewMode);
  const htmlScrollPercent = useStore((s) => s.htmlScrollPercent);
  const content = getContent(doc.id);
  const isHtml = doc.type === "html";
  const ide = isHtml;

  if (!isHtml) {
    return <MdCodeMirror doc={doc} className={className} />;
  }
  const lines = Math.max(1, content.split("\n").length);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const highlightRef = React.useRef<HTMLPreElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const syncingFromPreview = React.useRef(false);
  const unfollowUntil = React.useRef(0);
  const [flash, setFlash] = React.useState<{ top: number; height: number; key: number } | null>(
    null
  );
  const [caretLine, setCaretLine] = React.useState(1);
  const [activeBand, setActiveBand] = React.useState<{ top: number; height: number } | null>(
    null
  );
  const documents = useStore((s) => s.documents);
  const [wikiSuggest, setWikiSuggest] = React.useState<{
    start: number;
    query: string;
    items: { label: string; insert: string }[];
    index: number;
  } | null>(null);

  const highlightedHtml = React.useMemo(() => {
    if (!isHtml) return null;
    try {
      return hljs.highlight(content, { language: "xml", ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [content, isHtml]);

  const syncChromeScroll = React.useCallback((scrollTop: number) => {
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    if (highlightRef.current) highlightRef.current.scrollTop = scrollTop;
  }, []);

  const revealRange = React.useCallback(
    (start: number, end: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const s = Math.max(0, Math.min(start, content.length));
      const e = Math.max(s, Math.min(end, content.length));
      // Locating from preview — don't let scroll-sync fight the jump
      unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
      ta.focus();
      ta.setSelectionRange(s, e);
      const { top, height } = measureRange(ta, s, e);
      syncingFromPreview.current = true;
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 2 + height / 2);
      syncChromeScroll(ta.scrollTop);
      requestAnimationFrame(() => {
        syncingFromPreview.current = false;
      });
      setFlash({ top: top - ta.scrollTop, height, key: Date.now() });
      window.setTimeout(() => setFlash(null), 1200);
      const { line, col } = offsetToLineCol(content, s);
      setCaretLine(line);
      setEditorCaret({ line, col });
    },
    [content, setEditorCaret, syncChromeScroll]
  );

  React.useEffect(() => {
    if (!pendingReveal) return;
    const id = requestAnimationFrame(() => {
      revealRange(pendingReveal.start, pendingReveal.end);
      clearPendingReveal();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingReveal, revealRange, clearPendingReveal]);

  // Preview → source proportional scroll sync (HTML split only)
  React.useEffect(() => {
    if (!isHtml || viewMode !== "split") return;
    if (Date.now() < unfollowUntil.current) return;
    const ta = taRef.current;
    if (!ta) return;
    const next = scrollTopFromPercent(
      htmlScrollPercent,
      ta.scrollHeight,
      ta.clientHeight
    );
    if (Math.abs(ta.scrollTop - next) < 1) return;
    syncingFromPreview.current = true;
    ta.scrollTop = next;
    syncChromeScroll(next);
    requestAnimationFrame(() => {
      syncingFromPreview.current = false;
    });
  }, [htmlScrollPercent, isHtml, viewMode, syncChromeScroll, content]);

  const updateCaret = React.useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const { line, col } = offsetToLineCol(content, ta.selectionStart);
    setCaretLine(line);
    setEditorCaret({ line, col });
    const start = lineStartOffset(content, line);
    const end =
      line < lines
        ? lineStartOffset(content, line + 1)
        : content.length;
    try {
      const { top, height } = measureRange(ta, start, Math.max(start, end - (end > start ? 1 : 0)));
      setActiveBand({ top: top - ta.scrollTop, height: Math.min(height, parseFloat(getComputedStyle(ta).lineHeight) || 22) });
    } catch {
      setActiveBand(null);
    }
  }, [content, lines, setEditorCaret]);

  React.useEffect(() => {
    updateCaret();
  }, [updateCaret, content]);

  React.useEffect(() => {
    return () => setEditorCaret(null);
  }, [setEditorCaret, doc.id]);

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (doc.type !== "md") return;
    const html = e.clipboardData.getData("text/html");
    if (!html || !looksLikeRichHtml(html)) return;
    e.preventDefault();
    const md = htmlToMarkdown(html);
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + md + content.slice(end);
    setDraft(doc.id, next);
    const caret = start + md.length;
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = caret;
    });
    setStatus("已将富文本转为 Markdown");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (wikiSuggest && wikiSuggest.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setWikiSuggest((s) =>
          s ? { ...s, index: Math.min(s.items.length - 1, s.index + 1) } : s
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setWikiSuggest((s) => (s ? { ...s, index: Math.max(0, s.index - 1) } : s));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyWikiSuggest(wikiSuggest.items[wikiSuggest.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setWikiSuggest(null);
        return;
      }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = content.slice(0, start) + "  " + content.slice(end);
      setDraft(doc.id, next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      const ta = e.currentTarget;
      const offset = ta.selectionStart;
      if (viewMode === "source") {
        useStore.getState().setViewMode("split");
      }
      requestPreviewLocate(offset);
      setStatus("已在预览中定位");
    }
  };


  const refreshWikiSuggest = React.useCallback(
    (value: string, caret: number) => {
      if (doc.type !== "md") {
        setWikiSuggest(null);
        return;
      }
      const before = value.slice(0, caret);
      const m = before.match(/\[\[([^\]]*)$/);
      if (!m) {
        setWikiSuggest(null);
        return;
      }
      const q = m[1];
      const start = caret - q.length - 2;
      const hash = q.indexOf("#");
      const items: { label: string; insert: string }[] = [];
      if (hash >= 0) {
        const page = q.slice(0, hash).trim();
        const hPrefix = q.slice(hash + 1).toLowerCase();
        const target =
          documents.find((d) => titleOf(d.path) === page) ||
          documents.find((d) => getDocMeta(d).aliases.includes(page));
        if (target && target.type === "md") {
          for (const h of extractOutline(target.content)) {
            if (hPrefix && !h.text.toLowerCase().includes(hPrefix) && !h.id.includes(hPrefix))
              continue;
            items.push({
              label: `${page}#${h.text}`,
              insert: `${page}#${h.text}`,
            });
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
          for (const a of aliases) {
            if (!ql || a.toLowerCase().includes(ql)) {
              items.push({ label: `${a} → ${title}`, insert: a });
            }
          }
        }
      }
      setWikiSuggest({
        start,
        query: q,
        items: items.slice(0, 12),
        index: 0,
      });
    },
    [doc.type, documents]
  );

  const applyWikiSuggest = (item: { insert: string }) => {
    const ta = taRef.current;
    if (!ta || !wikiSuggest) return;
    const caret = ta.selectionStart;
    const before = content.slice(0, wikiSuggest.start);
    const after = content.slice(caret);
    // keep typing after ]] 
    const next = `${before}[[${item.insert}]]${after.replace(/^\]\]?/, "")}`;
    setDraft(doc.id, next);
    const newCaret = before.length + item.insert.length + 4;
    setWikiSuggest(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = newCaret;
    });
  };

  const gutterWidthCh = Math.max(3, String(lines).length);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full min-h-0 flex font-mono text-[13px] leading-[22px]",
        ide ? "lh-ide-editor" : "bg-[var(--bg-elevated)]",
        className
      )}
    >
      <div
        ref={gutterRef}
        className={cn(
          "lh-ide-gutter shrink-0 select-none overflow-hidden text-right border-r",
          ide
            ? "border-[color-mix(in_srgb,#fff_8%,transparent)] px-2 py-3 text-[11px] leading-[22px]"
            : "border-[var(--border)] px-3 py-4 text-[var(--muted)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] leading-6"
        )}
        style={{ minWidth: `${gutterWidthCh + 1.5}ch` }}
        aria-hidden
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn(
              ide && i + 1 === caretLine && "lh-ide-gutter-active"
            )}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <div className="relative flex-1 min-w-0 h-full">
        {ide && activeBand && (
          <div
            className="lh-ide-active-line pointer-events-none absolute left-0 right-0"
            style={{ top: activeBand.top, height: activeBand.height }}
            aria-hidden
          />
        )}
        {ide && highlightedHtml != null && (
          <pre
            ref={highlightRef}
            className="lh-ide-highlight pointer-events-none absolute inset-0 m-0 overflow-hidden px-4 py-3 whitespace-pre-wrap break-words"
            aria-hidden
            dangerouslySetInnerHTML={{
              __html: highlightedHtml.endsWith("\n")
                ? highlightedHtml
                : highlightedHtml + "\n",
            }}
          />
        )}
        <textarea
          ref={taRef}
          value={content}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(doc.id, v);
            refreshWikiSuggest(v, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={updateCaret}
          onClick={updateCaret}
          onSelect={updateCaret}
          onPaste={onPaste}
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop;
            syncChromeScroll(top);
            if (!syncingFromPreview.current) {
              unfollowUntil.current = Date.now() + SOURCE_SCROLL_UNFOLLOW_MS;
            }
            setFlash(null);
            if (ide) updateCaret();
          }}
          className={cn(
            "absolute inset-0 h-full w-full resize-none outline-none px-4",
            ide
              ? "lh-ide-textarea bg-transparent py-3 caret-[#e8e6e1]"
              : "bg-transparent py-4 text-[var(--fg)]"
          )}
          aria-label="源码编辑器"
        />
        {flash && (
          <div
            key={flash.key}
            className="lh-reveal-flash pointer-events-none absolute left-0 right-0 mx-4 rounded-sm"
            style={{ top: flash.top, height: flash.height }}
            aria-hidden
          />
        )}
      </div>

      {wikiSuggest && wikiSuggest.items.length > 0 && (
        <div className="absolute z-30 left-16 bottom-4 max-h-56 w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--menu)] shadow-xl p-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            双链补全
          </div>
          {wikiSuggest.items.map((it, i) => (
            <button
              key={it.label + i}
              type="button"
              className={cn(
                "flex w-full rounded-lg px-2 py-1.5 text-left text-xs truncate",
                i === wikiSuggest.index
                  ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                  : "hover:bg-[var(--hover)]"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                applyWikiSuggest(it);
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
