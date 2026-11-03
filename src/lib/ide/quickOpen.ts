/**
 * IDE Quick Open (⌘/Ctrl+P): path filter helpers. Paths only — no file bodies.
 */

import { normalizeIdeRelPath } from "./citations";

function basename(path: string): string {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Case-insensitive match on basename or full relative path. */
export function filterQuickOpenPaths(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths.map((p) => normalizeIdeRelPath(p)).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const p = normalizeIdeRelPath(raw);
    if (!p || seen.has(p)) continue;
    const base = basename(p).toLowerCase();
    const full = p.toLowerCase();
    if (base.includes(q) || full.includes(q)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * Empty query → current tab paths (deduped, stable order).
 * Non-empty → filter fileIndex (and never invent package→file mapping).
 */
export function planQuickOpenCandidates(opts: {
  query: string;
  fileIndex: string[];
  tabPaths: string[];
}): string[] {
  const q = opts.query.trim();
  if (!q) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of opts.tabPaths) {
      const p = normalizeIdeRelPath(raw);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }
  return filterQuickOpenPaths(opts.fileIndex, q);
}
