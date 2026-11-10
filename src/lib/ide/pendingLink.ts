/**
 * A `[[ide:…]]` link clicked in 藏书阁 while no project was open.
 *
 * The link is remembered (persisted, so a refresh keeps waiting for the same
 * target) and the 读码 welcome screen offers a banner that can open a project.
 * This module is pure: the store persists it, the banner renders it.
 */

import { isIdeCitationPath, normalizeIdeRelPath } from "./citations";
import { ideLinkLabel, type IdeLinkTarget } from "./ideLink";

function posInt(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < 1) return undefined;
  return n;
}

/** Persist/migrate helper: keep a usable target, drop anything else. */
export function normalizePendingIdeLink(raw: unknown): IdeLinkTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const path = normalizeIdeRelPath(typeof r.path === "string" ? r.path : "");
  if (!path || !isIdeCitationPath(path)) return null;
  const projectId =
    typeof r.projectId === "string" && r.projectId.trim()
      ? r.projectId.trim()
      : undefined;
  const snapshot =
    typeof r.snapshot === "string" && r.snapshot
      ? r.snapshot
      : undefined;
  const extras = {
    ...(projectId ? { projectId } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
  const line = posInt(r.line);
  if (line == null) return { path, ...extras };
  const endLine = posInt(r.endLine);
  const end = endLine != null && endLine > line ? endLine : undefined;
  return end != null
    ? { path, line, endLine: end, ...extras }
    : { path, line, ...extras };
}

/** `src/App.tsx · 第 10 行` — the "where", without the `ide:` scheme noise. */
export function pendingLinkLocation(target: IdeLinkTarget): string {
  const label = ideLinkLabel(target, 200);
  if (target.line == null) return label;
  const path = normalizeIdeRelPath(target.path);
  const lines =
    target.endLine != null && target.endLine > target.line
      ? `第 ${target.line}–${target.endLine} 行`
      : `第 ${target.line} 行`;
  return `${path} · ${lines}`;
}

export type PendingProjectGuess = {
  id: string;
  name: string;
  pathLabel: string;
};

/**
 * Best guess at which project owns the pending file: the project it was last
 * opened from. Returns null when nothing matches (or the match is no longer in
 * the 最近工程 list), so the banner can fall back to picking a folder.
 */
export function guessPendingProject(
  target: IdeLinkTarget,
  recentFiles: { sessionId: string; path: string }[],
  recent: { id: string; name: string; pathLabel: string }[]
): PendingProjectGuess | null {
  const path = normalizeIdeRelPath(target.path);
  if (!path) return null;
  if (target.projectId) {
    const meta = recent.find((r) => r.id === target.projectId);
    if (meta) {
      return { id: meta.id, name: meta.name, pathLabel: meta.pathLabel };
    }
  }
  for (const f of recentFiles) {
    if (normalizeIdeRelPath(f.path) !== path) continue;
    const meta = recent.find((r) => r.id === f.sessionId);
    if (meta) {
      return { id: meta.id, name: meta.name, pathLabel: meta.pathLabel };
    }
  }
  return null;
}
