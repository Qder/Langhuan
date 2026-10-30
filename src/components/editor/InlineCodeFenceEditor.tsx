"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  parseMarkdownFence,
  rebuildMarkdownFence,
  type ParsedMarkdownFence,
} from "@/lib/mdVisualSerialize";

export type InlineCodeFenceEditorProps = {
  /** `.lh-codeblock` (or annotated fence host) being edited. */
  anchorEl: HTMLElement;
  /** Full fenced Markdown slice including ``` / ~~~ wrappers. */
  originalSlice: string;
  /** Caret offset inside the fence *body* (not the full slice). */
  cursorAt?: number;
  clientX?: number;
  clientY?: number;
  suppressBlurRef?: React.MutableRefObject<boolean>;
  onCommit: (nextSlice: string) => void;
  onCancel: () => void;
};

/**
 * Seamless in-preview fenced-code editor.
 * Same chrome look as CodeBlock; textarea for body only (Enter = newline).
 * Esc cancel · ⌘/Ctrl+Enter commit · blur commit. No ringed "source" box.
 */
export function InlineCodeFenceEditor({
  anchorEl,
  originalSlice,
  cursorAt = 0,
  clientX,
  clientY,
  suppressBlurRef,
  onCommit,
  onCancel,
}: InlineCodeFenceEditorProps) {
  const parsedRef = React.useRef<ParsedMarkdownFence | null>(
    parseMarkdownFence(originalSlice)
  );
  const [body, setBody] = React.useState(
    () => parsedRef.current?.body ?? originalSlice
  );
  const bodyRef = React.useRef(body);
  bodyRef.current = body;
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const committedRef = React.useRef(false);

  React.useLayoutEffect(() => {
    const parent = anchorEl.parentElement;
    if (!parent) return;
    const host = document.createElement("div");
    host.setAttribute("data-lh-inline-editor", "code");
    host.className = "lh-inline-edit-slot my-0";
    // Hide first so slot + original never both paint (same as visual/source).
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

  const finish = React.useCallback(
    (mode: "commit" | "cancel") => {
      if (committedRef.current) return;
      committedRef.current = true;
      if (mode === "cancel") {
        onCancel();
        return;
      }
      const parsed = parsedRef.current;
      const curBody = bodyRef.current;
      if (!parsed) {
        // Unparseable — write back the edited text as-is (raw fence).
        onCommit(curBody);
        return;
      }
      onCommit(rebuildMarkdownFence(parsed, curBody));
    },
    [onCancel, onCommit]
  );

  React.useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !slot) return;
    const pos = Math.max(0, Math.min(cursorAt, body.length));
    try {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
    } catch {
      try {
        ta.focus();
      } catch {
        /* ignore */
      }
    }
    // If click coords given, refine caret via textarea metrics after focus.
    if (
      clientX != null &&
      clientY != null &&
      typeof document.caretPositionFromPoint === "function"
    ) {
      try {
        // Textarea caret from point is unreliable cross-browser; keep cursorAt.
      } catch {
        /* ignore */
      }
    }
    autosize(ta);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount into slot only
  }, [slot]);

  const lang = parsedRef.current?.lang || "code";
  const lineCount = Math.max(1, body.split("\n").length);

  if (!slot) return null;

  return createPortal(
    <div
      className={cn(
        "lh-codeblock lh-code-editing not-prose my-5 overflow-hidden rounded-[14px]",
        "border border-[rgba(236,228,210,0.08)] bg-[#1a1814] text-[#ece4d2]"
      )}
      data-lh-inline-editor="code-chrome"
    >
      <div className="lh-codeblock-chrome flex items-center gap-2 px-3 py-2 border-b border-[rgba(236,228,210,0.08)] text-xs">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        <span className="ml-2 text-[var(--muted)] font-mono">{lang}</span>
        <span className="ml-auto text-[10px] text-[var(--muted)]/70 select-none">
          Esc 取消 · ⌘⏎ 完成
        </span>
      </div>
      <div className="lh-codeblock-body flex min-w-0 overflow-x-auto">
        <div className="lh-code-gutter" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="lh-code-gutter-line">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          data-lh-inline-editor="code-textarea"
          value={body}
          spellCheck={false}
          onChange={(e) => {
            setBody(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (suppressBlurRef) suppressBlurRef.current = true;
              finish("cancel");
              return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (suppressBlurRef) suppressBlurRef.current = true;
              finish("commit");
              return;
            }
            // Enter inserts newline inside fence (default textarea) — do NOT stop.
            // Backspace at start stays inside fence — no merge into previous paragraph.
            if (e.key === "Tab") {
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              const next = body.slice(0, start) + "  " + body.slice(end);
              setBody(next);
              requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + 2;
                autosize(ta);
              });
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (suppressBlurRef?.current) {
                suppressBlurRef.current = false;
                return;
              }
              finish("commit");
            }, 0);
          }}
          className={cn(
            "flex-1 min-w-0 resize-none bg-transparent border-0 outline-none",
            "m-0 font-mono text-[0.86rem] leading-[1.65] text-[#ece4d2]",
            "whitespace-pre caret-[var(--accent)]",
            "lh-code-fence-ta"
          )}
          style={{
            padding: "1em 0.9em 1em 0.9em",
            minHeight: "3em",
            tabSize: 2,
          }}
          aria-label="编辑代码块"
        />
      </div>
    </div>,
    slot
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${Math.max(el.scrollHeight, 48)}px`;
}
