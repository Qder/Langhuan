"use client";

import * as React from "react";
import {
  serializeVisualBlock,
  type VisualBlockType,
} from "@/lib/mdVisualSerialize";
import { useStore } from "@/lib/store";
import {
  caretEdgeInBlock,
  hideVisualAnchorsBySrcRange,
  isCaretAtVisualBlockStart,
  mountIsolatedVisualHost,
  placeCaretPlain,
  splitVisualAtCaret,
  type SplitResult,
} from "@/lib/previewVisualCaret";

export type VisualNavDir = "prev" | "next";

export type InlineVisualBlockEditorProps = {
  /** Document that owns paste/drop image ingest. */
  docId: string;
  anchorEl: HTMLElement;
  originalSlice: string;
  blockType: VisualBlockType;
  /** Source offsets — re-hide remounted React twins after save/body rewrite. */
  srcStart: number;
  srcEnd: number;
  /**
   * Bumps when preview markdown remounts (body / doc.updatedAt).
   * Re-runs twin-hide + disconnect→commit.
   */
  remountEpoch: string | number;
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
  docId,
  anchorEl,
  originalSlice,
  blockType,
  srcStart,
  srcEnd,
  remountEpoch,
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
  const hostRef = React.useRef<HTMLElement | null>(null);
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
    hostRef.current = el;

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

    const performSplit = () => {
      if (committedRef.current) return;
      try {
        const serialized = serializeNow();
        const result = splitVisualAtCaret({
          element: el,
          blockType,
          originalSlice,
        });
        const handler = onSplitRef.current;
        if (handler && handler(result, serialized)) {
          markHandled();
          return;
        }
        finishCommit();
      } catch {
        // Never leave Enter as a silent no-op after preventDefault.
        try {
          finishCommit();
        } catch {
          /* ignore */
        }
      }
    };

    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertParagraph") return;
      // insertLineBreak = Shift+Enter soft break — leave to the browser.
      e.preventDefault();
      e.stopPropagation();
      performSplit();
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

      // Enter → hard-split (Shift+Enter keeps browser soft <br>)
      // Table cells: commit in place (splitting would break the GFM row).
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing || e.keyCode === 229) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (blockType === "tableCell") {
          if (suppressBlurRef) suppressBlurRef.current = true;
          finishCommit();
          return;
        }
        performSplit();
        return;
      }

      // Backspace at *true* block start → merge previous visual.
      // Mid-block / unknown selection: let the browser delete in place (no jump).
      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing || e.keyCode === 229) {
          return;
        }
        const sel = el.ownerDocument?.getSelection?.() || window.getSelection();
        if (!sel || !sel.isCollapsed) return; // selection delete = native
        if (!isCaretAtVisualBlockStart(el)) return;
        e.preventDefault();
        e.stopPropagation();
        const serialized = serializeNow();
        const handler = onMergePrevRef.current;
        if (handler && handler(serialized)) {
          markHandled();
          return;
        }
        // Boundary / no prev: swallow so we do not jump; stay put.
        return;
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

    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const image = [...cd.items].find((it) => it.type.startsWith("image/"));
      if (!image) return;
      const file = image.getAsFile();
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const res = await useStore.getState().ingestImageFile(docId, file, file.name || undefined);
        if (!res || committedRef.current) return;
        const img = el.ownerDocument.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = (file.name || "image").replace(/\.[^.]+$/, "");
        img.setAttribute("data-lh-md-href", res.href);
        img.className = "lh-md-img";
        const sel = el.ownerDocument.getSelection?.() || window.getSelection();
        if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(img);
          range.setStartAfter(img);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          el.appendChild(img);
        }
      })();
    };

    // Capture so we win over any bubble-phase CE/default handlers.
    el.addEventListener("beforeinput", onBeforeInput, true);
    el.addEventListener("keydown", onKeyDown, true);
    el.addEventListener("paste", onPaste, true);
    el.addEventListener("blur", onBlur);

    return () => {
      el.removeEventListener("beforeinput", onBeforeInput, true);
      el.removeEventListener("keydown", onKeyDown, true);
      el.removeEventListener("paste", onPaste, true);
      el.removeEventListener("blur", onBlur);
      hostRef.current = null;
      dispose();
    };
    // remount host only when the React anchor identity / slice changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, anchorEl, blockType, originalSlice, clientX, clientY, caretAt, suppressBlurRef]);

  // After save / body rewrite: MarkdownBody may remount a visible twin while
  // the isolated CE host is still implanted. Re-hide by src range; if the
  // original anchor is gone, flush-commit so only one card stays.
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !host.isConnected) return;
    const article =
      host.closest("article") ??
      document.getElementById("reader-scroll") ??
      host.parentElement;
    if (!article) return;

    hideVisualAnchorsBySrcRange(article, srcStart, srcEnd);

    if (!anchorEl.isConnected && !committedRef.current) {
      if (suppressBlurRef) suppressBlurRef.current = true;
      committedRef.current = true;
      try {
        onCommitRef.current(
          serializeVisualBlock({
            originalSlice,
            blockType,
            element: host,
          })
        );
      } catch {
        onCancelRef.current();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch drives remount reaction
  }, [remountEpoch, srcStart, srcEnd, anchorEl, originalSlice, blockType, suppressBlurRef]);

  return null;
}

function placeCaretFromPoint(
  el: HTMLElement,
  clientX?: number,
  clientY?: number
): void {
  const doc = el.ownerDocument;
  if (!doc) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
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
