"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import { htmlToMarkdown, looksLikeRichHtml } from "@/lib/htmlToMarkdown";
import { cn } from "@/lib/utils";

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
  const viewMode = useStore((s) => s.viewMode);
  const content = getContent(doc.id);
  const showLines = true;
  const lines = Math.max(1, content.split("\n").length);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [flash, setFlash] = React.useState<{ top: number; height: number; key: number } | null>(
    null
  );

  const revealRange = React.useCallback(
    (start: number, end: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const s = Math.max(0, Math.min(start, content.length));
      const e = Math.max(s, Math.min(end, content.length));
      ta.focus();
      ta.setSelectionRange(s, e);
      const { top, height } = measureRange(ta, s, e);
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 2 + height / 2);
      if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
      setFlash({ top: top - ta.scrollTop, height, key: Date.now() });
      window.setTimeout(() => setFlash(null), 1200);
    },
    [content.length]
  );

  React.useEffect(() => {
    if (!pendingReveal) return;
    // wait a frame so split layout lays out textarea
    const id = requestAnimationFrame(() => {
      revealRange(pendingReveal.start, pendingReveal.end);
      clearPendingReveal();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingReveal, revealRange, clearPendingReveal]);

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Plain-only paste (e.g. Ctrl+Shift+V) usually has no text/html → keep default.
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
    // Source → Preview: ⌘/Ctrl+Shift+Enter
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

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full min-h-0 flex font-mono text-[13px] leading-6 bg-[var(--bg-elevated)]",
        className
      )}
    >
      {showLines && (
        <div
          ref={gutterRef}
          className="shrink-0 select-none overflow-hidden px-3 py-4 text-right text-[var(--muted)] border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)]"
          aria-hidden
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      )}
      <div className="relative flex-1 min-w-0 h-full">
        <textarea
          ref={taRef}
          value={content}
          spellCheck={false}
          onChange={(e) => setDraft(doc.id, e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            // flash follows scroll only during animation — clear relative pos on scroll
            setFlash(null);
          }}
          className="absolute inset-0 h-full w-full resize-none bg-transparent px-4 py-4 outline-none text-[var(--fg)]"
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
    </div>
  );
}
