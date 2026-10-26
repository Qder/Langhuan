import type { MdBlockRange } from "./types";

export function closestSrcBlock(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.hasAttribute("data-src-start")) {
      return el;
    }
    el = el.parentNode;
  }
  return null;
}

export function readBlockRange(el: HTMLElement): MdBlockRange {
  const start = Number(el.getAttribute("data-src-start") || 0);
  const end = Number(el.getAttribute("data-src-end") || start);
  return { start, end };
}

/** Plain-text offset of caret within a block element's textContent. */
export function plainOffsetInBlock(block: HTMLElement, container: Node, offset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n === container) {
      return count + offset;
    }
    count += (n.textContent || "").length;
    n = walker.nextNode();
  }
  // container might be element
  if (container === block) {
    return Math.min(offset, (block.textContent || "").length);
  }
  return 0;
}

export function getPreviewSelectionInfo(root: ParentNode): {
  text: string;
  startBlock: MdBlockRange | null;
  endBlock: MdBlockRange | null;
  anchorPlainOffset: number;
  rect: DOMRect | null;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = String(sel);
  const startEl = closestSrcBlock(range.startContainer);
  const endEl = closestSrcBlock(range.endContainer);
  const startBlock = startEl ? readBlockRange(startEl) : null;
  const endBlock = endEl ? readBlockRange(endEl) : null;
  const anchorPlainOffset =
    startEl != null ? plainOffsetInBlock(startEl, range.startContainer, range.startOffset) : 0;
  let rect: DOMRect | null = null;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    rect = null;
  }
  return { text, startBlock, endBlock, anchorPlainOffset, rect };
}

export function srcAttrs(
  fmOffset: number,
  node: { position?: { start?: { offset?: number }; end?: { offset?: number } } } | undefined
): { "data-src-start": number; "data-src-end": number } | Record<string, never> {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return {};
  return {
    "data-src-start": start + fmOffset,
    "data-src-end": end + fmOffset,
  };
}
