/** Map a 0–100 scroll percent to textarea/pre scrollTop. */

export function clampScrollPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

/**
 * Proportional scroll sync: percent → scrollTop.
 * Good enough for v1; does not map DOM blocks to source lines.
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

/** Soft-unfollow window after the user scrolls the source pane (ms). */
export const SOURCE_SCROLL_UNFOLLOW_MS = 700;
