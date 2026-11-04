/**
 * Recently opened files in 读码, across projects.
 * Small and pure so the welcome screen and the "no file open" state can share it.
 */

import { normalizeIdeRelPath } from "./citations";

export const IDE_RECENT_FILES_MAX = 8;

export type IdeRecentFile = {
  /** Project session id (`fsa:<folder>`), or "" when unknown. */
  sessionId: string;
  /** Project display name; shown next to the path on the welcome screen. */
  projectName: string;
  /** Project-relative path. */
  path: string;
  openedAt: number;
};

function clean(rec: IdeRecentFile): IdeRecentFile | null {
  const path = normalizeIdeRelPath(rec.path || "");
  if (!path) return null;
  return {
    sessionId: String(rec.sessionId || ""),
    projectName: String(rec.projectName || ""),
    path,
    openedAt: Number.isFinite(rec.openedAt) ? rec.openedAt : 0,
  };
}

/**
 * Move a file to the front. Re-opening a path in a *different* project keeps
 * both entries, because the same relative path can exist in two projects.
 */
export function pushRecentFile(
  list: IdeRecentFile[],
  entry: IdeRecentFile,
  max = IDE_RECENT_FILES_MAX
): IdeRecentFile[] {
  const next = clean(entry);
  if (!next) return list;
  const rest = list.filter(
    (x) =>
      !(
        normalizeIdeRelPath(x.path) === next.path &&
        String(x.sessionId || "") === next.sessionId
      )
  );
  return [next, ...rest].slice(0, Math.max(0, max));
}

/** Drop malformed/duplicate entries and cap the list (persist migrate helper). */
export function normalizeRecentFiles(
  raw: unknown,
  max = IDE_RECENT_FILES_MAX
): IdeRecentFile[] {
  if (!Array.isArray(raw)) return [];
  const parsed: IdeRecentFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const rec = clean({
      sessionId: typeof r.sessionId === "string" ? r.sessionId : "",
      projectName: typeof r.projectName === "string" ? r.projectName : "",
      path: typeof r.path === "string" ? r.path : "",
      openedAt: typeof r.openedAt === "number" ? r.openedAt : 0,
    });
    if (rec) parsed.push(rec);
  }
  // Newest first, then dedupe so the freshest copy of a path is the keeper.
  parsed.sort((a, b) => b.openedAt - a.openedAt);
  const out: IdeRecentFile[] = [];
  const seen = new Set<string>();
  for (const rec of parsed) {
    const key = `${rec.sessionId}\0${rec.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out.slice(0, Math.max(0, max));
}

/** Files opened inside one project, newest first. */
export function recentFilesForSession(
  list: IdeRecentFile[],
  sessionId: string | null | undefined,
  max = IDE_RECENT_FILES_MAX
): string[] {
  if (!sessionId) return [];
  return list
    .filter((x) => x.sessionId === sessionId)
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((x) => x.path)
    .slice(0, Math.max(0, max));
}

/** Drop entries for a project that was removed from the recent list. */
export function pruneRecentFilesForSession(
  list: IdeRecentFile[],
  sessionId: string
): IdeRecentFile[] {
  return list.filter((x) => x.sessionId !== sessionId);
}
