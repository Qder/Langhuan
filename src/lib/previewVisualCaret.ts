/**
 * Preview visual-edit continuous-caret helpers.
 * Enter split / Backspace merge operate on Markdown slices; caller still
 * writebacks via replaceRange only (never joinMarkdownBlocks).
 */

import { trailingNewline } from "./mdInlineEdit";
import {
  classifyMdBlock,
  isSourceEditType,
  isVisualEditableType,
  serializeVisualDomHalf,
  serializeVisualBlock,
  type VisualBlockType,
} from "./mdVisualSerialize";

export type SplitResult =
  | {
      kind: "split";
      /** Full replacement for the current block range. */
      writeText: string;
      /** Second block [start,end) within writeText. */
      nextLocalStart: number;
      nextLocalEnd: number;
      nextBlockType: VisualBlockType;
    }
  | {
      kind: "delete";
      /** Empty string removes the list item line. */
      writeText: string;
    };

export type MergeResult = {
  writeText: string;
  /** Plain caret offset inside the merged visible body (approx). */
  caretPlain: number;
};

const LIST_FIRST =
  /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

function stripTrailingNl(slice: string): { core: string; nl: string } {
  const nl = trailingNewline(slice);
  return { core: nl ? slice.slice(0, -nl.length) : slice, nl: nl || "\n" };
}

function clampOffset(n: number, len: number): number {
  return Math.max(0, Math.min(len, Math.floor(n)));
}

/** Visible body length hints from DOM plain text when provided. */
export function splitVisualSlice(args: {
  slice: string;
  blockType: VisualBlockType;
  /** Caret offset in visible/plain text of the block. */
  plainOffset: number;
  /** Optional DOM plain text (more accurate after in-place edits). */
  plainText?: string;
}): SplitResult {
  const { slice, blockType } = args;
  const plain =
    args.plainText != null ? args.plainText : visibleBodyFromSlice(slice, blockType);
  const off = clampOffset(args.plainOffset, plain.length);
  const leftPlain = plain.slice(0, off);
  const rightPlain = plain.slice(off);

  if (blockType === "heading") {
    return splitHeading(slice, leftPlain, rightPlain);
  }
  if (blockType === "listItem") {
    return splitListItem(slice, leftPlain, rightPlain);
  }
  if (blockType === "blockquote") {
    return splitBlockquote(slice, leftPlain, rightPlain);
  }
  return splitParagraph(slice, leftPlain, rightPlain);
}

function visibleBodyFromSlice(slice: string, blockType: VisualBlockType): string {
  const { core } = stripTrailingNl(slice);
  if (blockType === "heading") {
    return core.replace(/^#{1,6}\s*/, "").replace(/\s*#+\s*$/, "");
  }
  if (blockType === "listItem") {
    const first = core.split(/\r?\n/)[0] ?? "";
    const m = first.match(LIST_FIRST);
    if (!m) return core;
    const rest = core.split(/\r?\n/).slice(1).join("\n");
    return rest ? `${m[5] ?? ""}\n${rest}` : (m[5] ?? "");
  }
  if (blockType === "blockquote") {
    return core
      .split(/\r?\n/)
      .map((l) => l.replace(/^>\s?/, ""))
      .join("\n");
  }
  return core;
}

function splitParagraph(
  slice: string,
  leftPlain: string,
  rightPlain: string
): SplitResult {
  const { nl } = stripTrailingNl(slice);
  const left = leftPlain + nl;
  const right = rightPlain + nl;
  const writeText = left + "\n" + right;
  // left ends with nl; one extra \n → blank line between paragraphs
  const nextLocalStart = left.length + 1;
  return {
    kind: "split",
    writeText,
    nextLocalStart,
    nextLocalEnd: writeText.length,
    nextBlockType: "paragraph",
  };
}

function splitHeading(
  slice: string,
  leftPlain: string,
  rightPlain: string
): SplitResult {
  const { core, nl } = stripTrailingNl(slice);
  const m = core.match(/^(#{1,6})(\s*)/);
  const hashes = m?.[1] ?? "#";
  const ws = m?.[2] && m[2].length > 0 ? m[2] : " ";
  const trail = core.match(/^(.*?)( +#+)\s*$/);
  const trailingMarks = trail ? trail[2]! : "";
  const left = hashes + ws + leftPlain + trailingMarks + nl;
  const right = rightPlain + nl;
  const writeText = left + "\n" + right;
  const nextLocalStart = left.length + 1;
  return {
    kind: "split",
    writeText,
    nextLocalStart,
    nextLocalEnd: writeText.length,
    nextBlockType: "paragraph",
  };
}

function splitListItem(
  slice: string,
  leftPlain: string,
  rightPlain: string
): SplitResult {
  const { core, nl } = stripTrailingNl(slice);
  const first = core.split(/\r?\n/)[0] ?? "";
  const m = first.match(LIST_FIRST);
  if (!m) {
    return splitParagraph(slice, leftPlain, rightPlain);
  }
  const indent = m[1]!;
  const marker = m[2]!;
  const afterMarkerWs = m[3]!;
  const task = m[4] || "";
  const prefix = indent + marker + afterMarkerWs + task;

  const bodyTrim = (leftPlain + rightPlain).trim();
  // Empty item Enter → delete the item.
  if (!bodyTrim && !leftPlain && !rightPlain) {
    return { kind: "delete", writeText: "" };
  }
  // Caret at start of empty-looking item (only whitespace body)
  if (!bodyTrim && leftPlain.trim() === "" && rightPlain.trim() === "") {
    return { kind: "delete", writeText: "" };
  }
  // Empty item: user pressed Enter with no content (plain empty)
  if ((leftPlain + rightPlain).length === 0) {
    return { kind: "delete", writeText: "" };
  }
  // Nonempty: if entire body is empty after trim and caret somehow mid-ws
  if (!leftPlain.trim() && !rightPlain.trim()) {
    return { kind: "delete", writeText: "" };
  }

  // If item body (both sides) is empty of real content → delete
  // Already handled. Nonempty: split into two items.
  // When left is empty and right nonempty — still two items (empty + content)
  // Spec: empty item deletes — so if leftPlain.trim()==='' && rightPlain.trim()==='' delete.
  // If left empty but right has content, keep as split (new item above?).
  // Spec: "空项删除该项并跳出列表；非空项新建下一项"
  // So: if the WHOLE item is empty → delete. If nonempty → always new item at caret.

  if (!(leftPlain + rightPlain).trim()) {
    return { kind: "delete", writeText: "" };
  }

  // Numbered lists: bump next marker if numeric
  let nextMarker = marker;
  const num = marker.match(/^(\d+)([.)])$/);
  if (num) {
    nextMarker = `${Number(num[1]) + 1}${num[2]}`;
  }
  const nextPrefix = indent + nextMarker + afterMarkerWs + task;

  const left = prefix + leftPlain + nl;
  const right = nextPrefix + rightPlain + nl;
  // List items: single newline between items (not blank line)
  const writeText = left + right;
  return {
    kind: "split",
    writeText,
    nextLocalStart: left.length,
    nextLocalEnd: writeText.length,
    nextBlockType: "listItem",
  };
}

function splitBlockquote(
  slice: string,
  leftPlain: string,
  rightPlain: string
): SplitResult {
  const { nl } = stripTrailingNl(slice);
  const leftLines = leftPlain.split(/\r?\n/).map((l) => "> " + l);
  const rightLines = rightPlain.split(/\r?\n/).map((l) => "> " + l);
  const left = (leftLines.join("\n") || ">") + nl;
  const right = (rightLines.join("\n") || ">") + nl;
  const writeText = left + "\n" + right;
  return {
    kind: "split",
    writeText,
    nextLocalStart: left.length + 1,
    nextLocalEnd: writeText.length,
    nextBlockType: "blockquote",
  };
}

/**
 * Merge two adjacent visual slices (Backspace at start of `next`).
 * Preserves prev block type prefix; appends next's visible body.
 */
export function mergeVisualSlices(args: {
  prevSlice: string;
  nextSlice: string;
  prevType: VisualBlockType;
  nextType: VisualBlockType;
}): MergeResult | null {
  const { prevSlice, nextSlice, prevType, nextType } = args;
  if (!isVisualEditableType(prevType) || isSourceEditType(prevType)) {
    return null;
  }
  if (!isVisualEditableType(nextType)) {
    return null;
  }

  const prevBody = visibleBodyFromSlice(prevSlice, prevType);
  const nextBody = visibleBodyFromSlice(nextSlice, nextType);
  const caretPlain = prevBody.length;

  if (prevType === "heading") {
    const { core, nl } = stripTrailingNl(prevSlice);
    const m = core.match(/^(#{1,6})(\s*)/);
    const hashes = m?.[1] ?? "#";
    const ws = m?.[2] && m[2].length > 0 ? m[2] : " ";
    const writeText = hashes + ws + prevBody + nextBody + nl;
    return { writeText, caretPlain };
  }

  if (prevType === "listItem") {
    const { core, nl } = stripTrailingNl(prevSlice);
    const first = core.split(/\r?\n/)[0] ?? "";
    const m = first.match(LIST_FIRST);
    if (!m) {
      const writeText = prevBody + nextBody + (trailingNewline(prevSlice) || "\n");
      return { writeText, caretPlain };
    }
    const prefix = m[1]! + m[2]! + m[3]! + (m[4] || "");
    const writeText = prefix + prevBody + nextBody + nl;
    return { writeText, caretPlain };
  }

  if (prevType === "blockquote") {
    const { nl } = stripTrailingNl(prevSlice);
    const merged = (prevBody + nextBody)
      .split(/\r?\n/)
      .map((l) => "> " + l)
      .join("\n");
    return { writeText: merged + nl, caretPlain };
  }

  // paragraph (or fallback)
  const nl = trailingNewline(prevSlice) || trailingNewline(nextSlice) || "\n";
  return { writeText: prevBody + nextBody + nl, caretPlain };
}

/** True when previous block must not be swallowed by Backspace merge. */
export function isMergeBoundaryType(t: VisualBlockType): boolean {
  return isSourceEditType(t) || !isVisualEditableType(t);
}

export function classifySlice(slice: string): VisualBlockType {
  return classifyMdBlock(slice);
}

/**
 * Plain-text caret offset inside a contenteditable element.
 */
export function plainCaretOffsetIn(el: HTMLElement): number {
  const doc = el.ownerDocument;
  if (!doc) return 0;
  const sel = doc.getSelection?.() || window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  try {
    const pre = doc.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  } catch {
    return 0;
  }
}

export function plainTextOf(el: HTMLElement): string {
  return el.textContent || "";
}

export type CaretEdge = "start" | "end" | null;

/**
 * Detect whether the collapsed caret sits at the start/end of the block
 * for arrow-key navigation. Vertical edges use a simple first/last-line heuristic.
 */
export function caretEdgeInBlock(
  el: HTMLElement,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
): CaretEdge {
  const doc = el.ownerDocument;
  if (!doc) return null;
  const sel = doc.getSelection?.() || window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const offset = plainCaretOffsetIn(el);
  const len = plainTextOf(el).length;

  if (key === "ArrowLeft" && offset <= 0) return "start";
  if (key === "ArrowRight" && offset >= len) return "end";

  if (key === "ArrowUp" || key === "ArrowDown") {
    try {
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      const caretRect =
        rects.length > 0
          ? rects[0]!
          : range.getBoundingClientRect();
      const blockRect = el.getBoundingClientRect();
      if (key === "ArrowUp") {
        // Near top of block
        if (offset <= 0) return "start";
        if (caretRect.top - blockRect.top < 8) return "start";
      } else {
        if (offset >= len) return "end";
        if (blockRect.bottom - caretRect.bottom < 8) return "end";
      }
    } catch {
      if (key === "ArrowUp" && offset <= 0) return "start";
      if (key === "ArrowDown" && offset >= len) return "end";
    }
  }
  return null;
}

/**
 * Place caret at plain offset (or start/end) inside element.
 */
export function placeCaretPlain(
  el: HTMLElement,
  at: "start" | "end" | number
): void {
  const doc = el.ownerDocument;
  if (!doc) return;
  try {
    el.focus();
  } catch {
    /* ignore */
  }
  const target =
    at === "start" ? 0 : at === "end" ? Infinity : Math.max(0, Math.floor(at));

  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = target;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    lastText = node;
    const len = node.data.length;
    if (remaining <= len) {
      const range = doc.createRange();
      range.setStart(node, Math.min(remaining, len));
      range.collapse(true);
      const sel = doc.getSelection?.() || window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Fallback: end of element
  try {
    const range = doc.createRange();
    if (lastText) {
      range.setStart(lastText, lastText.data.length);
    } else {
      range.selectNodeContents(el);
    }
    range.collapse(false);
    const sel = doc.getSelection?.() || window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* ignore */
  }
}


/** Zero-width space so an empty split target still renders a <p> for caret reopen. */
export const EMPTY_PARA_PLACEHOLDER = "\u200b";

/**
 * Split the live contenteditable host at the caret into two Markdown slices.
 * Uses DOM Range clones so inline <code>/<strong>/… survive (unlike plain-text split).
 * Empty right half becomes a ZWSP paragraph so rehype still emits a node to open.
 */
export function splitVisualAtCaret(args: {
  element: HTMLElement;
  blockType: VisualBlockType;
  originalSlice: string;
}): SplitResult {
  const { element: el, blockType, originalSlice } = args;
  const doc = el.ownerDocument;
  const plain = plainTextOf(el);
  const plainOffset = plainCaretOffsetIn(el);

  if (!doc) {
    return splitVisualSlice({
      slice: originalSlice,
      blockType,
      plainOffset,
      plainText: plain,
    });
  }

  const sel = doc.getSelection?.() || window.getSelection();
  const leftWrap = doc.createElement(el.tagName);
  const rightWrap = doc.createElement(el.tagName);

  let usedRange = false;
  if (sel && sel.rangeCount > 0) {
    const caret = sel.getRangeAt(0);
    if (el.contains(caret.startContainer)) {
      try {
        const leftRange = doc.createRange();
        leftRange.selectNodeContents(el);
        leftRange.setEnd(caret.startContainer, caret.startOffset);
        leftWrap.appendChild(leftRange.cloneContents());

        const rightRange = doc.createRange();
        rightRange.selectNodeContents(el);
        rightRange.setStart(caret.startContainer, caret.startOffset);
        rightWrap.appendChild(rightRange.cloneContents());
        usedRange = true;
      } catch {
        usedRange = false;
      }
    }
  }

  if (!usedRange) {
    // Fallback: plain-text split of a fresh serialize
    const serialized = serializeVisualBlock({
      originalSlice,
      blockType,
      element: el,
    });
    return splitVisualSlice({
      slice: serialized,
      blockType,
      plainOffset,
      plainText: plain,
    });
  }

  if (blockType === "paragraph") {
    const nl = originalSlice.match(/\r?\n$/)?.[0] || "\n";
    let leftMd = serializeVisualDomHalf("paragraph", leftWrap, originalSlice);
    let rightMd = serializeVisualDomHalf("paragraph", rightWrap, originalSlice);
    if (!/\r?\n$/.test(leftMd)) leftMd += nl;
    if (!/\r?\n$/.test(rightMd)) rightMd += nl;
    const leftPlain = plainTextOf(leftWrap).replace(/\u200b/g, "");
    const rightPlain = plainTextOf(rightWrap).replace(/\u200b/g, "");
    // Empty half must still render a <p> so pendingOpen can place the caret.
    if (!rightPlain) rightMd = EMPTY_PARA_PLACEHOLDER + nl;
    if (!leftPlain) leftMd = EMPTY_PARA_PLACEHOLDER + nl;
    // left ends with nl; one extra \n → blank line between paragraphs
    const writeText = leftMd + "\n" + rightMd;
    const nextLocalStart = leftMd.length + 1;
    return {
      kind: "split",
      writeText,
      nextLocalStart,
      nextLocalEnd: writeText.length,
      nextBlockType: "paragraph",
    };
  }

  // Heading / list / quote: markers live in originalSlice; plain-offset split is enough.
  return splitVisualSlice({
    slice: serializeVisualBlock({ originalSlice, blockType, element: el }),
    blockType,
    plainOffset,
    plainText: plain,
  });
}


/**
 * Clone a React-managed preview block into an isolated contenteditable host.
 * The original anchor stays untouched (hidden) so React can re-render without
 * fighting CE mutations (e.g. <strong> toggled by execCommand / typing).
 */
export type IsolatedVisualHost = {
  host: HTMLElement;
  dispose: () => void;
};

export function mountIsolatedVisualHost(
  anchorEl: HTMLElement
): IsolatedVisualHost | null {
  const parent = anchorEl.parentElement;
  if (!parent) return null;

  const host = anchorEl.cloneNode(true) as HTMLElement;
  // Identity stays on the React-owned node; clone must not pollute queries.
  host.removeAttribute("data-src-start");
  host.removeAttribute("data-src-end");
  host.removeAttribute("hidden");
  host.classList.remove("lh-inline-edit-hidden");

  host.setAttribute("contenteditable", "true");
  host.setAttribute("spellcheck", "true");
  host.setAttribute("data-lh-inline-editor", "visual");
  host.classList.add("lh-visual-editing");

  parent.insertBefore(host, anchorEl);
  anchorEl.setAttribute("hidden", "");
  anchorEl.classList.add("lh-inline-edit-hidden");

  const article = host.closest("article");
  if (article) article.setAttribute("data-lh-visual-editing", "1");

  return {
    host,
    dispose: () => {
      if (article) article.removeAttribute("data-lh-visual-editing");
      anchorEl.removeAttribute("hidden");
      anchorEl.classList.remove("lh-inline-edit-hidden");
      // Never touch anchorEl.innerHTML — React owns it.
      try {
        host.remove();
      } catch {
        /* ignore */
      }
    },
  };
}
