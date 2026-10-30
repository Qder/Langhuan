"use client";

import * as React from "react";
import {
  serializeVisualBlock,
  type VisualBlockType,
} from "@/lib/mdVisualSerialize";
import {
  caretEdgeInBlock,
  mountIsolatedVisualHost,
  placeCaretPlain,
  plainCaretOffsetIn,
  plainTextOf,
  splitVisualSlice,
  type SplitResult,
} from "@/lib/previewVisualCaret";

export type VisualNavDir = "prev" | "next";

export type InlineVisualBlockEditorProps = {
  anchorEl: HTMLElement;
  originalSlice: string;
  blockType: VisualBlockType;
  clientX?: number;
  clientY?: number;
  /** Prefer over clientX/Y when reopening after split/merge/nav. */
  caretAt?: "start" | "end" | number;
  suppressBlurRef?: React.MutableRefObject<boolean>;
  onCommit: (nextSlice: string) => void;
  onCancel: () => void;
  /**
   * Structural Enter: parent replaces range with writeText and opens next.
   * Return true if handled.
   */
  onSplit?: (result: SplitResult, serializedBefore: string) => boolean;
  /** Backspace at block start — parent merges with previous visual block. */
  onMergePrev?: (serializedBefore: string) => boolean;
  /** Arrow at edge — parent commits and opens adjacent visual block. */
  onNavigate?: (dir: VisualNavDir, serializedBefore: string) => boolean;
};

/**
 * Preview visual edit on an *isolated* contenteditable clone of the block.
 * The React-managed rehype node stays hidden/untouched so CE mutations
 * (bold/strong, italic, typing) cannot trigger removeChild NotFoundError
 * when MarkdownBody re-renders. Continuous-caret: Enter splits, Backspace
 * merges, arrows cross blocks. Commit via serializeVisualBlock + replaceRange.
 */
export function InlineVisualBlockEditor({
  anchorEl,
  originalSlice,
  blockType,
  clientX,
  clientY,
  caretAt,
  suppressBlurRef,
  onCommit,
  onCancel,
  onSplit,
  onMergePrev,
  onNavigate,
}: InlineVisualBlockEditorProps) {
  const committedRef = React.useRef(false);
  const onCommitRef = React.useRef(onCommit);
  const onCancelRef = React.useRef(onCancel);
  const onSplitRef = React.useRef(onSplit);
  const onMergePrevRef = React.useRef(onMergePrev);
  const onNavigateRef = React.useRef(onNavigate);

  React.useEffect(() => {
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
    onSplitRef.current = onSplit;
    onMergePrevRef.current = onMergePrev;
    onNavigateRef.current = onNavigate;
  }, [onCommit, onCancel, onSplit, onMergePrev, onNavigate]);

  React.useLayoutEffect(() => {
    committedRef.current = false;
    const mounted = mountIsolatedVisualHost(anchorEl);
    if (!mounted) return;
    const { host: el, dispose } = mounted;

    if (caretAt != null) {
      placeCaretPlain(el, caretAt);
    } else {
      placeCaretFromPoint(el, clientX, clientY);
    }

    const serializeNow = () =>
      serializeVisualBlock({
        originalSlice,
        blockType,
        element: el,
      });

    const finishCommit = () => {
      if (committedRef.current) return;
      committedRef.current = true;
      onCommitRef.current(serializeNow());
    };

    const finishCancel = () => {
      if (committedRef.current) return;
      committedRef.current = true;
      // Original React node was never mutated — just tear down the host.
      onCancelRef.current();
    };

    const markHandled = () => {
      committedRef.current = true;
      if (suppressBlurRef) suppressBlurRef.current = true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (suppressBlurRef) suppressBlurRef.current = true;
        finishCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (suppressBlurRef) suppressBlurRef.current = true;
        finishCommit();
        return;
      }

      // Enter → split (no shift=soft break inside block)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const serialized = serializeNow();
        const plainOffset = plainCaretOffsetIn(el);
        const plainText = plainTextOf(el);
        const result = splitVisualSlice({
          slice: serialized,
          blockType,
          plainOffset,
          plainText,
        });
        const handler = onSplitRef.current;
        if (handler && handler(result, serialized)) {
          markHandled();
          return;
        }
        finishCommit();
        return;
      }

      // Backspace at start → merge with previous visual block
      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const sel = el.ownerDocument?.getSelection?.() || window.getSelection();
        if (sel && sel.isCollapsed && plainCaretOffsetIn(el) <= 0) {
          e.preventDefault();
          e.stopPropagation();
          const serialized = serializeNow();
          const handler = onMergePrevRef.current;
          if (handler && handler(serialized)) {
            markHandled();
            return;
          }
          return;
        }
      }

      // Arrow keys at edge → adjacent visual block
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        const edge = caretEdgeInBlock(
          el,
          e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
        );
        if (edge) {
          const dir: VisualNavDir = edge === "start" ? "prev" : "next";
          const outward =
            (edge === "start" &&
              (e.key === "ArrowLeft" || e.key === "ArrowUp")) ||
            (edge === "end" &&
              (e.key === "ArrowRight" || e.key === "ArrowDown"));
          if (outward) {
            const handler = onNavigateRef.current;
            if (handler) {
              e.preventDefault();
              e.stopPropagation();
              const serialized = serializeNow();
              if (handler(dir, serialized)) {
                markHandled();
                return;
              }
            }
          }
        }
      }

      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === "b") {
          e.preventDefault();
          try {
            document.execCommand("bold");
          } catch {
            /* ignore */
          }
          return;
        }
        if (k === "i") {
          e.preventDefault();
          try {
            document.execCommand("italic");
          } catch {
            /* ignore */
          }
          return;
        }
        if (k === "`" || k === "e") {
          e.preventDefault();
          wrapSelectionInlineCode();
          return;
        }
        if (k === "k") {
          e.preventDefault();
          const url = window.prompt("链接 URL");
          if (url) {
            try {
              document.execCommand("createLink", false, url);
            } catch {
              /* ignore */
            }
          }
        }
      }
    };

    const onBlur = () => {
      window.setTimeout(() => {
        if (suppressBlurRef?.current) {
          suppressBlurRef.current = false;
          return;
        }
        if (committedRef.current) return;
        finishCommit();
      }, 0);
    };

    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("blur", onBlur);

    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      dispose();
    };
  }, [
    anchorEl,
    blockType,
    originalSlice,
    clientX,
    clientY,
    caretAt,
    suppressBlurRef,
  ]);

  return null;
}

function placeCaretFromPoint(
  el: HTMLElement,
  clientX?: number,
  clientY?: number
): void {
  const doc = el.ownerDocument;
  if (!doc) {
    el.focus();
    return;
  }
  try {
    el.focus();
  } catch {
    /* ignore */
  }
  if (
    typeof clientX === "number" &&
    typeof clientY === "number" &&
    Number.isFinite(clientX) &&
    Number.isFinite(clientY)
  ) {
    const anyDoc = doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (typeof anyDoc.caretRangeFromPoint === "function") {
      range = anyDoc.caretRangeFromPoint(clientX, clientY);
    } else if (typeof anyDoc.caretPositionFromPoint === "function") {
      const pos = anyDoc.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (range && el.contains(range.startContainer)) {
      const sel = doc.getSelection?.() || window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  }
  placeCaretPlain(el, "end");
}

function wrapSelectionInlineCode(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  try {
    const text = range.toString();
    const code = document.createElement("code");
    code.textContent = text;
    range.deleteContents();
    range.insertNode(code);
    sel.removeAllRanges();
    const after = document.createRange();
    after.setStartAfter(code);
    after.collapse(true);
    sel.addRange(after);
  } catch {
    try {
      document.execCommand("fontName", false, "monospace");
    } catch {
      /* ignore */
    }
  }
}
