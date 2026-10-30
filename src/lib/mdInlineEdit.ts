/**
 * Offset-based Markdown slice edits for preview click-to-edit.
 * Never rebuild the whole document (unlike joinMarkdownBlocks).
 */

export type SrcRange = { start: number; end: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Trailing \n or \r\n of a string, or "" if none. */
export function trailingNewline(text: string): string {
  if (text.endsWith("\r\n")) return "\r\n";
  if (text.endsWith("\n")) return "\n";
  return "";
}

function looksLikeBlockStart(text: string): boolean {
  return /^(#{1,6}\s|```|~~~|\d+\.\s|[-*+]\s|>\s|\$\$)/.test(text);
}

/**
 * Replace [start, end) in `source` with `nextText`.
 * Bytes outside the range stay identical.
 *
 * Block-boundary rule: if the original slice ended with a newline and
 * `nextText` does not, keep one trailing newline so the following block
 * (e.g. a heading marker) is not glued onto this block's last line.
 */
export function replaceRange(
  source: string,
  start: number,
  end: number,
  nextText: string
): string {
  const s = clamp(Math.floor(start), 0, source.length);
  const e = clamp(Math.floor(end), s, source.length);
  const original = source.slice(s, e);
  let text = nextText;

  const origNl = trailingNewline(original);
  const nextNl = trailingNewline(text);
  if (origNl && !nextNl) {
    text = text + origNl;
  } else if (!origNl && !nextNl) {
    const after = source.slice(e);
    if (
      after.length > 0 &&
      after[0] !== "\n" &&
      after[0] !== "\r" &&
      looksLikeBlockStart(after)
    ) {
      text = text + "\n";
    }
  }

  return source.slice(0, s) + text + source.slice(e);
}

/** True when slice looks like a fenced code / mermaid / math block. */
export function isMonoSrcSlice(slice: string): boolean {
  const t = slice.trimStart();
  return (
    t.startsWith("```") ||
    t.startsWith("~~~") ||
    t.startsWith("$$") ||
    /^```\s*mermaid/i.test(t)
  );
}

/**
 * Prepare an "append at end" edit session.
 * Ensures the document ends with a blank line separator when non-empty,
 * without mutating until the caller applies replaceRange / setDraft.
 */
export function prepareAppendAtEnd(source: string): {
  /** Source with trailing separator already applied (may equal source). */
  prepared: string;
  start: number;
  end: number;
} {
  let prepared = source;
  if (prepared.length === 0) {
    return { prepared, start: 0, end: 0 };
  }
  // Normalize to end with exactly one separating blank line for a new paragraph.
  if (!prepared.endsWith("\n")) prepared += "\n";
  if (!prepared.endsWith("\n\n")) prepared += "\n";
  const start = prepared.length;
  return { prepared, start, end: start };
}

/**
 * True when clientY is below the last annotated src block (or doc has none).
 * Used for preview "click empty → append paragraph".
 */
export function isClientYBelowLastSrcBlock(
  root: ParentNode,
  clientY: number,
  slackPx = 4
): boolean {
  const blocks = [
    ...root.querySelectorAll<HTMLElement>("[data-src-start]"),
  ].filter(
    (b) => !(b.tagName === "SPAN" && b.hasAttribute("data-src-line"))
  );
  const last = blocks[blocks.length - 1];
  if (!last) return true;
  return clientY > last.getBoundingClientRect().bottom + slackPx;
}

export type SrcBlockGeom = {
  el: HTMLElement;
  start: number;
  end: number;
  top: number;
  bottom: number;
};

/**
 * Top-level annotated preview blocks (excludes per-line code spans and
 * blocks fully contained in a larger annotated ancestor).
 */
export function listAnnotatedSrcBlocks(root: ParentNode): SrcBlockGeom[] {
  const raw = [
    ...root.querySelectorAll<HTMLElement>("[data-src-start]"),
  ].filter(
    (b) => !(b.tagName === "SPAN" && b.hasAttribute("data-src-line"))
  );
  const withGeom: SrcBlockGeom[] = [];
  for (const el of raw) {
    const start = Number(el.getAttribute("data-src-start"));
    const end = Number(el.getAttribute("data-src-end") || start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const rect = el.getBoundingClientRect();
    withGeom.push({
      el,
      start,
      end,
      top: rect.top,
      bottom: rect.bottom,
    });
  }
  const filtered = withGeom.filter(
    (b, _i, arr) =>
      !arr.some(
        (o) =>
          o !== b &&
          o.start <= b.start &&
          o.end >= b.end &&
          o.end - o.start > b.end - b.start
      )
  );
  return filtered.sort((a, b) => a.top - b.top || a.start - b.start);
}

/**
 * When clientY sits in the visual gap between two annotated blocks, return
 * the source offset after the previous block (insert point for a new paragraph).
 */
export function findGapInsertAt(
  root: ParentNode,
  clientY: number,
  slackPx = 2
): { insertAt: number; prev: SrcBlockGeom; next: SrcBlockGeom } | null {
  const blocks = listAnnotatedSrcBlocks(root);
  for (let i = 0; i < blocks.length - 1; i++) {
    const prev = blocks[i]!;
    const next = blocks[i + 1]!;
    if (clientY > prev.bottom + slackPx && clientY < next.top - slackPx) {
      return { insertAt: prev.end, prev, next };
    }
  }
  return null;
}

/**
 * Prepare a mid-document paragraph insert at `insertAt` (typically previous
 * block's data-src-end). Same contract as prepareAppendAtEnd: caller writes
 * via replaceRange(prepared, start, end, normalizeAppendWriteText(...)).
 */
export function prepareInsertBetween(
  source: string,
  insertAt: number
): {
  prepared: string;
  start: number;
  end: number;
} {
  const at = clamp(Math.floor(insertAt), 0, source.length);
  if (at >= source.length) return prepareAppendAtEnd(source);

  let left = source.slice(0, at);
  let right = source.slice(at);
  if (left.length > 0 && !left.endsWith("\n")) left += "\n";
  if (left.length > 0 && !left.endsWith("\n\n")) left += "\n";
  right = right.replace(/^\n+/, "");
  // writeText ends with \n; one extra \n before right → blank line separator.
  const sep = right.length > 0 ? "\n" : "";
  const prepared = left + sep + right;
  return { prepared, start: left.length, end: left.length };
}

/**
 * Normalize user text from the append editor into a Markdown paragraph slice
 * inserted at EOF (after prepareAppendAtEnd). Empty/whitespace-only → "".
 */
export function normalizeAppendWriteText(text: string): string {
  if (!text.trim()) return "";
  // Drop trailing whitespace/newlines, then end with a single \n.
  return text.replace(/\s+$/u, "") + "\n";
}

/**
 * Guess caret offset inside a source slice from clicked preview text.
 * Falls back to 0 when no confident match.
 */
export function guessCursorInSlice(
  slice: string,
  opts?: { clickText?: string; approxOffset?: number }
): number {
  if (
    typeof opts?.approxOffset === "number" &&
    Number.isFinite(opts.approxOffset)
  ) {
    return clamp(Math.floor(opts.approxOffset), 0, slice.length);
  }
  const clickText = opts?.clickText?.trim();
  if (clickText && clickText.length >= 1) {
    const idx = slice.indexOf(clickText);
    if (idx >= 0) return idx;
    // Soft: first line-ish match ignoring extra whitespace
    const compact = clickText.replace(/\s+/g, " ");
    const soft = slice.replace(/\s+/g, " ");
    const softIdx = soft.indexOf(compact);
    if (softIdx >= 0) {
      // Map soft index back roughly by scanning
      let si = 0;
      for (let i = 0; i < slice.length; i++) {
        if (si === softIdx) return i;
        if (/\s/.test(slice[i]!)) {
          if (si < soft.length && soft[si] === " ") si += 1;
          while (i + 1 < slice.length && /\s/.test(slice[i + 1]!)) i += 1;
        } else {
          si += 1;
        }
      }
    }
  }
  return 0;
}

const LINE_SPAN_TAG = "SPAN";

/**
 * Resolve the editable block element from a click target.
 * Prefers outer code/mermaid wrappers over per-line spans;
 * climbs to the nearest ancestor with data-src-start.
 */
export function findEditableSrcBlock(
  target: Element | null,
  root: Element
): { el: HTMLElement; start: number; end: number } | null {
  if (!target || !root.contains(target)) return null;
  let el = (target as Element).closest("[data-src-start]") as HTMLElement | null;
  if (!el || !root.contains(el)) return null;

  const wrap = el.closest(".lh-codeblock, .lh-mermaid") as HTMLElement | null;
  if (wrap && wrap.hasAttribute("data-src-start") && root.contains(wrap)) {
    el = wrap;
  } else if (
    el.tagName === LINE_SPAN_TAG &&
    el.hasAttribute("data-src-line")
  ) {
    const parent = el.parentElement?.closest(
      "[data-src-start]"
    ) as HTMLElement | null;
    if (parent && root.contains(parent)) el = parent;
  }

  const start = Number(el.getAttribute("data-src-start"));
  const end = Number(el.getAttribute("data-src-end") || start);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return { el, start, end };
}

/**
 * Rough plain-text offset of a caret point within a block element.
 * Used only as a hint for guessCursorInSlice.
 */
export function plainOffsetInElement(
  block: HTMLElement,
  clientX: number,
  clientY: number
): { clickText: string; approxOffset: number } | null {
  const doc = block.ownerDocument;
  if (!doc) return null;
  let range: Range | null = null;
  const anyDoc = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };
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
  if (!range || !block.contains(range.startContainer)) {
    return null;
  }
  try {
    const pre = doc.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    const before = pre.toString();
    const approxOffset = before.length;
    // A short word around the caret for slice search
    const full = block.textContent || "";
    const from = Math.max(0, approxOffset - 12);
    const to = Math.min(full.length, approxOffset + 12);
    const clickText = full.slice(from, to).trim();
    return { clickText, approxOffset };
  } catch {
    return null;
  }
}
