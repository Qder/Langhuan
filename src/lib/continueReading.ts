/** Pick the library document last read from scroll / reading-progress memory. */

export type ContinueReadingProgress = {
  savedAt?: number;
  ratio?: number;
  top?: number;
};

export type ContinueReadingDoc = {
  id: string;
  path: string;
  updatedAt?: number;
};

/**
 * Choose the live library document with the newest reading-progress `savedAt`.
 * `updatedAt` is ignored — a recently edited but unread note must not win
 * over a document the user actually read later.
 * Missing / deleted / renamed paths are skipped. No progress → null
 * (do not fall back to recently edited).
 */
export function pickContinueReading<T extends ContinueReadingDoc>(
  documents: readonly T[],
  progress: Record<string, ContinueReadingProgress | undefined | null>
): T | null {
  if (!documents.length) return null;
  const byPath = new Map<string, T>();
  for (const doc of documents) {
    if (!doc?.path) continue;
    byPath.set(doc.path, doc);
  }
  let best: T | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const [path, entry] of Object.entries(progress)) {
    if (!entry || !Number.isFinite(entry.savedAt)) continue;
    const doc = byPath.get(path);
    if (!doc) continue;
    const at = entry.savedAt as number;
    if (at > bestAt) {
      bestAt = at;
      best = doc;
    }
  }
  return best;
}

/** Honest recent-notes list: newest `updatedAt` first. Not last-read. */
export function recentNotesByUpdatedAt<T extends { updatedAt: number }>(
  documents: readonly T[],
  limit = 8
): T[] {
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
