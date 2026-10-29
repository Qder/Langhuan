/** Anchor-based scroll sync (percent is fallback only). */

import type { Anchor } from "./types";

/** Soft-unfollow window after the user scrolls the source pane (ms). Legacy. */
export const SOURCE_SCROLL_UNFOLLOW_MS = 700;

/** Ignore inbound scroll from the driven side after programmatic scroll (ms). */
export const IGNORE_WINDOW_MS = 100;

/** Clear activeSource after scroll settles (ms). */
export const ACTIVE_RESET_MS = 150;

/** Min delta before updating driven scrollTop (px). */
export const SCROLL_EPSILON_PX = 2;

export type SyncDriver = "preview" | "editor";

export type SyncScrollMachine = {
  syncEnabled: boolean;
  activeSource: SyncDriver | null;
  /** Timestamp until which the opposite side's scroll events are ignored. */
  ignoreUntil: number;
  /** Timestamp of last driving scroll; used to reset activeSource. */
  lastDriveAt: number;
};

export function createSyncScrollMachine(syncEnabled = true): SyncScrollMachine {
  return {
    syncEnabled,
    activeSource: null,
    ignoreUntil: 0,
    lastDriveAt: 0,
  };
}

export function clampScrollPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

/**
 * Proportional scroll sync: percent → scrollTop.
 * Fallback when anchors are missing or zero-span.
 */
export function scrollTopFromPercent(
  percent: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  if (max <= 0) return 0;
  return (clampScrollPercent(percent) / 100) * max;
}

export function percentFromScrollTop(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  if (max <= 0) return 0;
  return clampScrollPercent((scrollTop / max) * 100);
}

/** Binary search: largest index with key <= value; -1 if all greater. */
export function lowerBoundIndex(sortedKeys: number[], value: number): number {
  let lo = 0;
  let hi = sortedKeys.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Linear interpolate `out` between adjacent points sorted by `key`.
 * Returns null when points are empty.
 */
export function interpolateKeyed(
  value: number,
  points: Array<{ key: number; out: number }>
): number | null {
  if (!points.length) return null;
  if (points.length === 1) return points[0].out;

  const keys = points.map((p) => p.key);
  const i = lowerBoundIndex(keys, value);

  if (i < 0) return points[0].out;
  if (i >= points.length - 1) {
    // Duplicate keys at end → treat as zero-span, return left value
    if (i > 0 && points[i].key === points[i - 1].key) return points[i - 1].out;
    return points[i].out;
  }

  const a = points[i];
  const b = points[i + 1];
  const span = b.key - a.key;
  if (span <= 0 || !Number.isFinite(span)) {
    return a.out;
  }
  const t = (value - a.key) / span;
  return a.out + t * (b.out - a.out);
}

/** Parallel arrays for O(log n) scroll mapping without re-sorting. */
export type SortedAnchorArrays = {
  /** previewTop ascending */
  previewTops: number[];
  /** start aligned with previewTops order */
  startsByPreview: number[];
  /** start ascending */
  starts: number[];
  /** previewTop aligned with starts order */
  previewTopsByStart: number[];
};

export function buildSortedAnchorArrays(anchors: Anchor[]): SortedAnchorArrays {
  const byPreview = [...anchors].sort(
    (a, b) => a.previewTop - b.previewTop || a.start - b.start
  );
  const byStart = [...anchors].sort(
    (a, b) => a.start - b.start || a.previewTop - b.previewTop
  );
  return {
    previewTops: byPreview.map((a) => a.previewTop),
    startsByPreview: byPreview.map((a) => a.start),
    starts: byStart.map((a) => a.start),
    previewTopsByStart: byStart.map((a) => a.previewTop),
  };
}

/**
 * Interpolate using pre-sorted parallel key/out arrays (no alloc of points).
 * Same semantics as interpolateKeyed on {key,out} pairs.
 */
export function interpolateParallel(
  value: number,
  keys: number[],
  outs: number[]
): number | null {
  const n = keys.length;
  if (!n || outs.length !== n) return null;
  if (n === 1) return outs[0];
  const i = lowerBoundIndex(keys, value);
  if (i < 0) return outs[0];
  if (i >= n - 1) {
    if (i > 0 && keys[i] === keys[i - 1]) return outs[i - 1];
    return outs[i];
  }
  const keyA = keys[i];
  const keyB = keys[i + 1];
  const span = keyB - keyA;
  if (span <= 0 || !Number.isFinite(span)) return outs[i];
  const t = (value - keyA) / span;
  return outs[i] + t * (outs[i + 1] - outs[i]);
}

/** Map preview viewport top → source start using pre-sorted arrays. */
export function previewTopToSourceOffsetSorted(
  viewportTop: number,
  previewTops: number[],
  startsByPreview: number[]
): number | null {
  return interpolateParallel(viewportTop, previewTops, startsByPreview);
}

/** Map source offset → preview top using pre-sorted arrays. */
export function sourceOffsetToPreviewTopSorted(
  offset: number,
  starts: number[],
  previewTopsByStart: number[]
): number | null {
  return interpolateParallel(offset, starts, previewTopsByStart);
}

/** Map preview viewport top → source start offset via anchors. */
export function previewTopToSourceOffset(
  viewportTop: number,
  anchors: Anchor[]
): number | null {
  if (!anchors.length) return null;
  const { previewTops, startsByPreview } = buildSortedAnchorArrays(anchors);
  return previewTopToSourceOffsetSorted(viewportTop, previewTops, startsByPreview);
}

/** Map source offset → preview element top via anchors. */
export function sourceOffsetToPreviewTop(
  offset: number,
  anchors: Anchor[]
): number | null {
  if (!anchors.length) return null;
  const { starts, previewTopsByStart } = buildSortedAnchorArrays(anchors);
  return sourceOffsetToPreviewTopSorted(offset, starts, previewTopsByStart);
}


/**
 * Given a desired content-coordinate (e.g. element top), compute scrollTop
 * so that coordinate sits near the top of the viewport (with small pad).
 */
export function scrollTopForContentY(
  contentY: number,
  clientHeight: number,
  scrollHeight: number,
  pad = 0
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(max, contentY - pad));
}

/** Whether an inbound scroll event from `from` should drive the other pane. */
export function shouldAcceptDrive(
  machine: SyncScrollMachine,
  from: SyncDriver,
  now: number
): boolean {
  if (!machine.syncEnabled) return false;
  if (now < machine.ignoreUntil) return false;
  if (machine.activeSource && machine.activeSource !== from) return false;
  return true;
}

/** Mark `from` as the driving side and bump activity timestamp. */
export function beginDrive(
  machine: SyncScrollMachine,
  from: SyncDriver,
  now: number
): SyncScrollMachine {
  return {
    ...machine,
    activeSource: from,
    lastDriveAt: now,
  };
}

/** After programmatically scrolling the driven side, open an ignore window. */
export function afterProgrammaticScroll(
  machine: SyncScrollMachine,
  now: number,
  ignoreMs = IGNORE_WINDOW_MS
): SyncScrollMachine {
  return {
    ...machine,
    ignoreUntil: now + ignoreMs,
  };
}

/** Clear activeSource when settled. */
export function maybeResetActive(
  machine: SyncScrollMachine,
  now: number,
  resetMs = ACTIVE_RESET_MS
): SyncScrollMachine {
  if (!machine.activeSource) return machine;
  if (now - machine.lastDriveAt < resetMs) return machine;
  return { ...machine, activeSource: null };
}

export function shouldUpdateScrollTop(current: number, next: number): boolean {
  return Math.abs(current - next) > SCROLL_EPSILON_PX;
}

/**
 * Build a lightweight Anchor list from DOM elements annotated with
 * data-src-start/end (Markdown) or data-lh (HTML). Positions are relative
 * to `scrollRoot` (offsetTop chain or getBoundingClientRect delta).
 */
export function measureAnchorsFromElements(
  elements: Array<{
    id: string;
    start: number;
    end: number;
    startLine: number;
    endLine: number;
    top: number;
    height: number;
  }>
): Anchor[] {
  return elements
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.top))
    .map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
      startLine: e.startLine,
      endLine: e.endLine,
      previewTop: e.top,
      previewHeight: Math.max(0, e.height),
    }))
    .sort((a, b) => a.previewTop - b.previewTop || a.start - b.start);
}

/** Parse `data-lh="12-45"` → {start,end} or null. */

/**
 * Measure Markdown data-src-* anchors relative to a scroll root.
 * Batch: one root rect, then all element rects, then derive tops (no RW interleave).
 */
export function measureMdAnchorsInDom(
  scrollRoot: HTMLElement,
  article: HTMLElement
): Anchor[] {
  const rootRect = scrollRoot.getBoundingClientRect();
  const nodes = article.querySelectorAll<HTMLElement>("[data-src-start]");
  const n = nodes.length;
  const rects: DOMRect[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rects[i] = nodes[i].getBoundingClientRect();
  }
  const scrollTop = scrollRoot.scrollTop;
  const elements: Array<{
    id: string;
    start: number;
    end: number;
    startLine: number;
    endLine: number;
    top: number;
    height: number;
  }> = [];
  for (let i = 0; i < n; i++) {
    const el = nodes[i];
    const start = Number(el.getAttribute("data-src-start"));
    const end = Number(el.getAttribute("data-src-end") || start);
    const line = Number(el.getAttribute("data-src-line") || 1);
    const rect = rects[i];
    elements.push({
      id: `md-${i}`,
      start,
      end,
      startLine: line,
      endLine: line,
      top: rect.top - rootRect.top + scrollTop,
      height: rect.height,
    });
  }
  return measureAnchorsFromElements(elements);
}

export function parseDataLh(value: string | null | undefined): {
  start: number;
  end: number;
} | null {
  if (!value) return null;
  const m = String(value).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/**
 * Whether the reported anchors are dense enough around viewportTop to
 * interpolate a source offset. Dynamic HTML pages often only annotate the
 * shell in <head>/early body; their max previewTop stays near 0 while the
 * user scrolls deep into script-generated content — then we must fall back
 * to percent sync instead of locking the editor on CSS/:root.
 */
export function anchorsCoverViewport(
  viewportTop: number,
  anchors: Array<{ previewTop: number }>,
  slack = 120
): boolean {
  if (!anchors.length) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const a of anchors) {
    const t = a.previewTop;
    if (!Number.isFinite(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  // All anchors well above the viewport → no coverage of current view.
  if (max < viewportTop - slack) return false;
  // All anchors well below the viewport.
  if (min > viewportTop + slack) return false;
  return true;
}

/**
 * Clamp a document offset into [0, docLength].
 * Non-finite values become 0. docLength < 0 is treated as 0.
 */
export function clampDocPos(pos: number, docLength: number): number {
  const len = Number.isFinite(docLength) && docLength > 0 ? Math.floor(docLength) : 0;
  if (!Number.isFinite(pos)) return 0;
  return Math.max(0, Math.min(Math.floor(pos), len));
}
