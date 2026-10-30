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
  /** Source offsets — used to re-hide remounted React twins after save/body rewrite. */
  srcStart: number;
  srcEnd: number;
  /**
   * Bumps when preview markdown remounts (body / doc.updatedAt).
   * Re-runs twin-hide + disconnect→commit.
   */
  remountEpoch: string | number;
  /** Caret offset inside the fence *body* (not the full slice). */
  cursorAt?: number;
  clientX?: number;
  clientY?: number;
  suppressBlurRef?: React.MutableRefObject<boolean>;
  onCommit: (nextSlice: string) => void;
  onCancel: () => void;
};

function hideAnchor(el: HTMLElement): void {
  el.setAttribute("hidden", "");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-lh-visual-anchor-hidden", "1");
  el.classList.add("lh-inline-edit-hidden");
  el.style.setProperty("display", "none", "important");
}

function showAnchor(el: HTMLElement): void {
  el.removeAttribute("hidden");
  el.removeAttribute("aria-hidden");
  el.removeAttribute("data-lh-visual-anchor-hidden");
  el.classList.remove("lh-inline-edit-hidden");
  el.style.removeProperty("display");
}

/** Drop orphan seamless code hosts (save remount / interrupted dispose). */
export function removeOrphanCodeFenceHosts(
  scope: ParentNode,
  keep?: HTMLElement | null
): number {
  let n = 0;
  for (const node of Array.from(
    scope.querySelectorAll<HTMLElement>('[data-lh-inline-editor="code"]')
  )) {
    if (keep && (node === keep || keep.contains(node))) continue;
    try {
      node.remove();
      n++;
    } catch {
      /* ignore */
    }
  }
  return n;
}

/**
 * Seamless in-preview fenced-code editor.
 * Same chrome look as CodeBlock; textarea for body only (Enter = newline).
 * Esc cancel · ⌘/Ctrl+Enter commit · blur commit. No ringed "source" box.
 *
 * Host is implanted beside the React-owned `.lh-codeblock`. When save/body
 * remounts MarkdownBody, a fresh CodeBlock can appear while this host remains
 * — we re-hide matching anchors by src range, and if the original anchor is
 * gone we flush-commit so only one fence stays visible.
 */
export function InlineCodeFenceEditor({
  anchorEl,
  originalSlice,
  srcStart,
  srcEnd,
  remountEpoch,
  cursorAt = 0,
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
  React.useEffect(() => {
    bodyRef.current = body;
  }, [body]);
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const committedRef = React.useRef(false);
  const hiddenTwinsRef = React.useRef<Set<HTMLElement>>(new Set());
  const onCommitRef = React.useRef(onCommit);
  const onCancelRef = React.useRef(onCancel);
  React.useEffect(() => {
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
  }, [onCommit, onCancel]);

  const finish = React.useCallback((mode: "commit" | "cancel") => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (mode === "cancel") {
      onCancelRef.current();
      return;
    }
    const parsed = parsedRef.current;
    const curBody = bodyRef.current;
    if (!parsed) {
      onCommitRef.current(curBody);
      return;
    }
    onCommitRef.current(rebuildMarkdownFence(parsed, curBody));
  }, []);

  const hideMatchingTwins = React.useCallback(
    (scope: ParentNode) => {
      const nodes = scope.querySelectorAll<HTMLElement>(
        ".lh-codeblock[data-src-start]"
      );
      for (const el of Array.from(nodes)) {
        // Skip our editor chrome (also has lh-codeblock class).
        if (el.getAttribute("data-lh-inline-editor") === "code-chrome") continue;
        if (el.closest('[data-lh-inline-editor="code"]')) continue;
        const s = Number(el.getAttribute("data-src-start"));
        const e = Number(el.getAttribute("data-src-end") || s);
        if (s !== srcStart) continue;
        if (
          Number.isFinite(srcEnd) &&
          Number.isFinite(e) &&
          e !== srcEnd
        ) {
          continue;
        }
        hideAnchor(el);
        hiddenTwinsRef.current.add(el);
      }
    },
    [srcStart, srcEnd]
  );

  React.useLayoutEffect(() => {
    const parent = anchorEl.parentElement;
    if (!parent) return;
    const article =
      anchorEl.closest("article") ??
      document.getElementById("reader-scroll") ??
      parent;

    // Prior session may have left a host if dispose raced a remount.
    removeOrphanCodeFenceHosts(article);

    const host = document.createElement("div");
    host.setAttribute("data-lh-inline-editor", "code");
    host.setAttribute("data-lh-code-edit-start", String(srcStart));
    host.setAttribute("data-lh-code-edit-end", String(srcEnd));
    host.className = "lh-inline-edit-slot my-0";
    hostRef.current = host;

    hideAnchor(anchorEl);
    hiddenTwinsRef.current.add(anchorEl);
    parent.insertBefore(host, anchorEl);
    setSlot(host);

    return () => {
      // Host first — never leave chrome beside a remounted React fence.
      try {
        if (host.isConnected) host.remove();
      } catch {
        /* ignore */
      }
      removeOrphanCodeFenceHosts(article, null);
      for (const el of hiddenTwinsRef.current) {
        try {
          if (el.isConnected) showAnchor(el);
        } catch {
          /* ignore */
        }
      }
      hiddenTwinsRef.current.clear();
      hostRef.current = null;
      setSlot(null);
    };
    // intentional: remount host only when the React anchor identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorEl]);

  // After save / body rewrite: MarkdownBody remounts a visible twin CodeBlock.
  // Re-hide by src range; if original anchor is gone, flush-commit to end session.
  React.useLayoutEffect(() => {
    if (!slot) return;
    const article =
      slot.closest("article") ??
      document.getElementById("reader-scroll") ??
      slot.parentElement;
    if (!article) return;

    hideMatchingTwins(article);

    if (!anchorEl.isConnected && !committedRef.current) {
      // React replaced the fence under us (typical: save clears draft → documents
      // prop change remounts MarkdownBody). Commit local textarea → one fence.
      if (suppressBlurRef) suppressBlurRef.current = true;
      finish("commit");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch drives remount reaction
  }, [remountEpoch, slot, hideMatchingTwins, finish, anchorEl, suppressBlurRef]);

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
    autosize(ta);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount into slot only
  }, [slot]);

  const lang = React.useMemo(
    () => parseMarkdownFence(originalSlice)?.lang || "code",
    [originalSlice]
  );
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
            // Enter inserts newline inside fence (default textarea).
            // Backspace at start stays inside — no merge into previous paragraph.
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
