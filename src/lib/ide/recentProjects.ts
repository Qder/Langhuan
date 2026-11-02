export const IDE_RECENT_MAX = 6;

export type IdeRecentProjectMeta = {
  /** Stable key (handle name + optional tag); used for IDB handle lookup. */
  id: string;
  /** Display name (folder basename). */
  name: string;
  /** Absolute path when known (Tauri); otherwise same as name. */
  pathLabel: string;
  lastOpenedAt: number;
};

/** Prepend `item` and keep at most `max` unique by id (most-recent first). */
export function pushRecentProject(
  list: IdeRecentProjectMeta[],
  item: IdeRecentProjectMeta,
  max: number = IDE_RECENT_MAX
): IdeRecentProjectMeta[] {
  const filtered = list.filter((p) => p.id !== item.id);
  return [item, ...filtered].slice(0, Math.max(0, max));
}

export function removeRecentProject(
  list: IdeRecentProjectMeta[],
  id: string
): IdeRecentProjectMeta[] {
  return list.filter((p) => p.id !== id);
}
