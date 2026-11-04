/**
 * Notes → 读码 deep links.
 *
 * Canonical syntax (the one written into notes, and the one we parse):
 *
 *   [[ide:src/foo/Bar.java]]        → open the file
 *   [[ide:src/foo/Bar.java:12]]     → open and reveal line 12
 *   [[ide:src/foo/Bar.java:12-20]]  → reveal a range
 *
 * Defensive extras: `ide://` after the colon and a `#L12-L20` hash are both
 * accepted, because people paste links from the explain panel / editor.
 *
 * This module stays pure so it can be unit-tested without a project.
 */

import { isIdeCitationPath, normalizeIdeRelPath } from "./citations";

export const IDE_LINK_SCHEME = "ide:";

export type IdeLinkTarget = {
  /** Project-relative path with `/` separators. */
  path: string;
  line?: number;
  endLine?: number;
};

/** True when a wikilink target (the part inside `[[…]]`) is an ide: link. */
export function isIdeLinkTarget(target: string | null | undefined): boolean {
  if (!target) return false;
  return /^ide:\/\//i.test(target.trim()) || /^ide:/i.test(target.trim());
}

function posInt(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/**
 * Parse `ide:path[:line[-endLine]]` / `ide://path[#L12[-L20]]`.
 * Returns null for empty or non-file targets (so callers can fall through).
 */
export function parseIdeLinkTarget(raw: string): IdeLinkTarget | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || !isIdeLinkTarget(trimmed)) return null;

  let rest = trimmed.slice(trimmed.indexOf(":") + 1);
  rest = rest.replace(/^\/\//, "").trim();
  if (!rest) return null;

  let line: number | undefined;
  let endLine: number | undefined;

  // `#L12-L20` (hash form wins over the colon form when both are present).
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    const frag = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
    const m = frag.match(/^L(\d+)(?:-L?(\d+))?$/i);
    if (m) {
      line = posInt(m[1]);
      endLine = posInt(m[2]);
    }
  } else {
    // Windows drive-ish guard: skip a trailing `C:` style pseudo-line.
    const m = rest.match(/^(.*?):(\d+)(?:-(\d+))?$/);
    if (m) {
      rest = m[1];
      line = posInt(m[2]);
      endLine = posInt(m[3]);
    }
  }

  const path = normalizeIdeRelPath(rest);
  if (!path || !isIdeCitationPath(path)) return null;

  if (line == null) return { path };
  const start = line;
  const end = endLine != null && endLine > start ? endLine : undefined;
  return end != null ? { path, line: start, endLine: end } : { path, line: start };
}

/** Build the canonical `[[ide:…]]` markdown people can paste into notes. */
export function formatIdeLink(
  path: string,
  line?: number,
  endLine?: number
): string {
  const p = normalizeIdeRelPath(path);
  if (line == null || !Number.isFinite(line) || line < 1) {
    return `[[${IDE_LINK_SCHEME}${p}]]`;
  }
  const start = Math.floor(line);
  const end =
    endLine != null && Number.isFinite(endLine) && Math.floor(endLine) > start
      ? Math.floor(endLine)
      : null;
  const suffix = end != null ? `${start}-${end}` : `${start}`;
  return `[[${IDE_LINK_SCHEME}${p}:${suffix}]]`;
}

/** `src/foo/Bar.java:12-20` — chip caption, no scheme. */
export function ideLinkLabel(target: IdeLinkTarget, maxPathChars = 42): string {
  const path = normalizeIdeRelPath(target.path);
  const shown =
    path.length <= maxPathChars
      ? path
      : `…${path.slice(path.length - maxPathChars + 1)}`;
  if (target.line == null) return shown;
  const suffix =
    target.endLine != null && target.endLine > target.line
      ? `:${target.line}-${target.endLine}`
      : `:${target.line}`;
  return `${shown}${suffix}`;
}
