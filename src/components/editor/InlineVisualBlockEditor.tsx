"use client";

import * as React from "react";
import {
  serializeVisualBlock,
  type VisualBlockType,
} from "@/lib/mdVisualSerialize";

export type InlineVisualBlockEditorProps = {
  anchorEl: HTMLElement;
  originalSlice: string;
  blockType: VisualBlockType;
  clientX?: number;
  clientY?: number;
  suppressBlurRef?: React.MutableRefObject<boolean>;
  onCommit: (nextSlice: string) => void;
  onCancel: () => void;
};

/**
 * Preview visual edit: make the rendered block contenteditable (no textarea).
 * Commit serializes DOM → Markdown slice via serializeVisualBlock.
 */
export function InlineVisualBlockEditor({
  anchorEl,
  originalSlice,
  blockType,
  clientX,
  clientY,
  suppressBlurRef,
  onCommit,
  onCancel,
}: InlineVisualBlockEditorProps) {
  const committedRef = React.useRef(false);
  const snapshotRef = React.useRef<string>("");
  const onCommitRef = React.useRef(onCommit);
  const onCancelRef = React.useRef(onCancel);

  React.useEffect(() => {
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
  }, [onCommit, onCancel]);

  React.useLayoutEffect(() => {
    committedRef.current = false;
    const el = anchorEl;
    snapshotRef.current = el.innerHTML;
    const article = el.closest("article");

    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.setAttribute("data-lh-inline-editor", "visual");
    el.classList.add("lh-visual-editing");
    if (article) article.setAttribute("data-lh-visual-editing", "1");

    placeCaret(el, clientX, clientY);

    const finishCommit = () => {
      if (committedRef.current) return;
      committedRef.current = true;
      const next = serializeVisualBlock({
        originalSlice,
        blockType,
        element: el,
      });
      onCommitRef.current(next);
    };

    const finishCancel = () => {
      if (committedRef.current) return;
      committedRef.current = true;
      try {
        el.innerHTML = snapshotRef.current;
      } catch {
        /* ignore */
      }
      onCancelRef.current();
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
      if (!committedRef.current) {
        try {
          el.innerHTML = snapshotRef.current;
        } catch {
          /* ignore */
        }
      }
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
      el.removeAttribute("data-lh-inline-editor");
      el.classList.remove("lh-visual-editing");
      if (article) article.removeAttribute("data-lh-visual-editing");
    };
  }, [anchorEl, blockType, originalSlice, clientX, clientY, suppressBlurRef]);

  return null;
}

function placeCaret(
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
  try {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection?.() || window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* ignore */
  }
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
