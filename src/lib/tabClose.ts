/** Pure helpers for tab-bar close-context actions (skip pinned by default). */

export type TabCloseMode = "self" | "left" | "right" | "others" | "all";

/**
 * Ids that would be closed for the given mode.
 * - self: the target only (caller may still refuse if pinned — matches ×)
 * - left/right/others/all: exclude pinned tabs
 */
export function tabsToClose(
  openTabs: string[],
  pinnedTabs: string[],
  targetId: string,
  mode: TabCloseMode
): string[] {
  const idx = openTabs.indexOf(targetId);
  if (mode === "self") {
    return idx >= 0 ? [targetId] : [];
  }
  const pinned = new Set(pinnedTabs);
  const candidates: string[] = [];
  for (let i = 0; i < openTabs.length; i++) {
    const id = openTabs[i]!;
    if (pinned.has(id)) continue;
    if (mode === "left") {
      if (idx >= 0 && i < idx) candidates.push(id);
    } else if (mode === "right") {
      if (idx >= 0 && i > idx) candidates.push(id);
    } else if (mode === "others") {
      if (id !== targetId) candidates.push(id);
    } else if (mode === "all") {
      candidates.push(id);
    }
  }
  return candidates;
}

/** Whether a menu action has nothing useful to do (for grey-out). */
export function tabCloseActionDisabled(
  openTabs: string[],
  pinnedTabs: string[],
  targetId: string,
  mode: TabCloseMode
): boolean {
  if (mode === "self") {
    // Match ×: pinned tabs cannot be closed via「关闭」
    return !openTabs.includes(targetId) || pinnedTabs.includes(targetId);
  }
  return tabsToClose(openTabs, pinnedTabs, targetId, mode).length === 0;
}

/**
 * Pick next active id after removing `closed` from `openTabs`.
 * Prefer neighbor at the old active index (same as single closeTab).
 */
export function nextActiveAfterClose(
  openTabs: string[],
  activeId: string | null,
  closed: ReadonlySet<string>
): string | null {
  const next = openTabs.filter((t) => !closed.has(t));
  if (!activeId || !closed.has(activeId)) {
    return activeId && next.includes(activeId) ? activeId : next[0] || null;
  }
  const idx = openTabs.indexOf(activeId);
  if (idx < 0) return next[0] || null;
  return next[Math.min(idx, next.length - 1)] || next[0] || null;
}
