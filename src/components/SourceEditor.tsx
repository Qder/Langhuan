"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SourceEditor({
  doc,
  className,
}: {
  doc: Document;
  className?: string;
}) {
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const content = getContent(doc.id);
  const showLines = doc.type === "html" || true;
  const lines = Math.max(1, content.split("\n").length);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);

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
    }
  };

  return (
    <div className={cn("h-full min-h-0 flex font-mono text-[13px] leading-6 bg-[var(--bg-elevated)]", className)}>
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
      <textarea
        ref={taRef}
        value={content}
        spellCheck={false}
        onChange={(e) => setDraft(doc.id, e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className="flex-1 min-w-0 h-full resize-none bg-transparent px-4 py-4 outline-none text-[var(--fg)]"
        aria-label="源码编辑器"
      />
    </div>
  );
}
