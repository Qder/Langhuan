"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type InlineMdBlockEditorProps = {
  /** Element being edited — replaced in-flow by this editor. */
  anchorEl: HTMLElement;
  value: string;
  mono?: boolean;
  cursorAt?: number;
  /** When true, blur must not commit (Esc / switching blocks). */
  suppressBlurRef?: React.MutableRefObject<boolean>;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

/**
 * In-flow Markdown slice editor for preview click-to-edit.
 * Uses a prose-like textarea (not a full WYSIWYG lib).
 */
export function InlineMdBlockEditor({
  anchorEl,
  value,
  mono = false,
  cursorAt = 0,
  suppressBlurRef,
  onChange,
  onCommit,
  onCancel,
}: InlineMdBlockEditorProps) {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const parent = anchorEl.parentElement;
    if (!parent) return;
    const host = document.createElement("div");
    host.setAttribute("data-lh-inline-editor", "1");
    host.className = "lh-inline-edit-slot my-0";
    // Hide first so slot + original never both paint.
    anchorEl.setAttribute("hidden", "");
    anchorEl.setAttribute("aria-hidden", "true");
    anchorEl.setAttribute("data-lh-visual-anchor-hidden", "1");
    anchorEl.classList.add("lh-inline-edit-hidden");
    anchorEl.style.setProperty("display", "none", "important");
    parent.insertBefore(host, anchorEl);
    setSlot(host);
    return () => {
      try {
        if (host.isConnected) host.remove();
      } catch {
        /* ignore */
      }
      anchorEl.removeAttribute("hidden");
      anchorEl.removeAttribute("aria-hidden");
      anchorEl.removeAttribute("data-lh-visual-anchor-hidden");
      anchorEl.classList.remove("lh-inline-edit-hidden");
      anchorEl.style.removeProperty("display");
      setSlot(null);
    };
  }, [anchorEl]);

  React.useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = Math.max(0, Math.min(cursorAt, value.length));
    try {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    } catch {
      ta.focus();
    }
    // Auto-size to content
    ta.style.height = "0px";
    ta.style.height = `${Math.max(ta.scrollHeight, 32)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount into slot
  }, [slot]);

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 32)}px`;
  };

  if (!slot) return null;

  return createPortal(
    <div
      className={cn(
        "lh-inline-edit-box rounded-lg ring-1 ring-[var(--accent)]/45 bg-[var(--bg-elevated)]/80",
        "px-2 py-1.5 shadow-sm"
      )}
    >
      <textarea
        ref={taRef}
        data-lh-inline-editor="textarea"
        value={value}
        spellCheck={!mono}
        onChange={(e) => {
          onChange(e.target.value);
          autosize(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (suppressBlurRef) suppressBlurRef.current = true;
            onCancel();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (suppressBlurRef) suppressBlurRef.current = true;
            onCommit();
            return;
          }
          // Keep Tab as indent inside the editor
          if (e.key === "Tab") {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const next =
              value.slice(0, start) + "  " + value.slice(end);
            onChange(next);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + 2;
              autosize(ta);
            });
          }
        }}
        onBlur={() => {
          // Defer so a click on another block can set suppressBlurRef first.
          window.setTimeout(() => {
            if (suppressBlurRef?.current) {
              suppressBlurRef.current = false;
              return;
            }
            onCommit();
          }, 0);
        }}
        className={cn(
          "w-full resize-none bg-transparent border-0 outline-none p-0 m-0",
          "text-[var(--fg)] leading-relaxed",
          mono
            ? "font-mono text-[0.9em] whitespace-pre"
            : "font-serif text-[length:inherit] whitespace-pre-wrap"
        )}
        style={{
          fontSize: "inherit",
          lineHeight: "inherit",
          minHeight: 32,
        }}
        aria-label="编辑 Markdown 块"
      />
    </div>,
    slot
  );
}
