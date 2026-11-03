/**
 * After openFile / citation chip jump: explorer row scroll + brief highlight.
 * Scroll itself is DOM-bound; pure helpers keep timing + give-up policy testable.
 */

export const EXPLORER_REVEAL_HIGHLIGHT_MS = 1500;
export const EXPLORER_REVEAL_GIVE_UP_MS = 2000;

/** Keep polling for the file row until found or give-up window elapses. */
export function explorerRevealStillWaiting(
  startedAtMs: number,
  nowMs: number,
  rowFound: boolean
): boolean {
  if (rowFound) return false;
  return nowMs - startedAtMs < EXPLORER_REVEAL_GIVE_UP_MS;
}

/** CSS selector for a file row stamped with `data-ide-path`. */
export function explorerRowSelector(path: string): string {
  // CSS.escape is available in browsers; vitest/node may lack it — fall back.
  const esc =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(path)
      : path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[data-ide-path="${esc}"]`;
}
