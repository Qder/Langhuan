/**
 * When to recompute the 读码 outline.
 *
 * The rail used to re-extract the whole file on every keystroke: for a big file
 * that is a full regex sweep per character, and the panel felt glued. The rule
 * is simple and deliberately not clever:
 *
 *   - the file changed → compute now, the rail must describe the new file;
 *   - the same file's text changed → wait out the typing burst, then compute.
 *
 * Pure so the timings can be asserted without a DOM.
 */

/** Quiet period after the last keystroke before a re-scan. */
export const OUTLINE_DEBOUNCE_MS = 120;

/** Same, for files where a sweep is measurably more expensive. */
export const OUTLINE_DEBOUNCE_LARGE_MS = 200;

/** Above this many characters we treat the file as "large". */
export const OUTLINE_LARGE_CHARS = 200_000;

/** Above this many lines we treat the file as "large". */
export const OUTLINE_LARGE_LINES = 5_000;

export function outlineDebounceMs(content: string): number {
  if (content.length >= OUTLINE_LARGE_CHARS) return OUTLINE_DEBOUNCE_LARGE_MS;
  if (countLines(content) >= OUTLINE_LARGE_LINES) return OUTLINE_DEBOUNCE_LARGE_MS;
  return OUTLINE_DEBOUNCE_MS;
}

/** Cheap newline count — stops early once the large-file threshold is passed. */
function countLines(content: string): number {
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      lines += 1;
      if (lines >= OUTLINE_LARGE_LINES) return lines;
    }
  }
  return lines;
}

export type OutlineRefreshPlan =
  /** `delay === 0` — the path changed, recompute before the next paint. */
  | { immediate: true; delay: 0 }
  /** Same file, edited: recompute after `delay` ms of quiet. */
  | { immediate: false; delay: number };

/**
 * Decide how a new (path, draft) pair should be turned into an outline.
 * A file switch wins over a size-based delay: a stale outline for the old file
 * would point at rows that do not exist in the new one.
 */
export function planOutlineRefresh(
  prevPath: string,
  nextPath: string,
  content: string
): OutlineRefreshPlan {
  if (prevPath !== nextPath) return { immediate: true, delay: 0 };
  return { immediate: false, delay: outlineDebounceMs(content) };
}
