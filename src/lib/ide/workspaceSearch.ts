/**
 * 工程内文本搜索 (Mod+Shift+F) — browser-only, read-only.
 *
 * Reuses the explorer's own listing / reading functions, walks with a depth
 * and file-count budget, skips ignored dirs and binary-looking files, and
 * stops on the first N hits. No ripgrep, no index service, no writes.
 */

import type { IdeFsEntry, IdeFolderSession } from "./ideFs";
import { isLikelyTextPath } from "./ideFs";
import { shouldIgnoreName } from "./ignore";

export const WORKSPACE_SEARCH_MAX_FILES = 600;
export const WORKSPACE_SEARCH_MAX_DEPTH = 8;
export const WORKSPACE_SEARCH_MAX_HITS = 200;
export const WORKSPACE_SEARCH_MAX_FILE_BYTES = 512 * 1024;
export const WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE = 20;
export const WORKSPACE_SEARCH_CONTEXT_CHARS = 160;

export type WorkspaceSearchHit = {
  path: string;
  /** 1-based line. */
  line: number;
  /** Trimmed single-line context around the match. */
  context: string;
  /** Column of the match inside `context` (0-based), for highlighting. */
  matchStart: number;
  matchLength: number;
};

export type WorkspaceSearchResult = {
  hits: WorkspaceSearchHit[];
  /** Files actually read. */
  scannedFiles: number;
  /** Files skipped by size / binary heuristic / read failure. */
  skippedFiles: number;
  /** True when a budget stopped the walk — the list is partial. */
  truncated: boolean;
};

export type WorkspaceSearchIo = {
  listDir: (relDir: string) => Promise<IdeFsEntry[]>;
  /** Returns body text, or a byte-size-carrying rejection for big files. */
  readFile: (relPath: string) => Promise<{ content: string; bytes?: number }>;
};

export function parseWorkspaceQuery(raw: string): string {
  return String(raw ?? "").trim();
}

type ParsedQuery =
  | { kind: "literal"; needle: string }
  | { kind: "regex"; re: RegExp; source: string };

/**
 * `re:` / `/…/` opts into a regex; everything else is a case-insensitive
 * literal. A bad regex falls back to a literal so typing never errors out.
 */
export function parseWorkspaceQueryPattern(raw: string): ParsedQuery {
  const q = parseWorkspaceQuery(raw);
  const slash = q.match(/^\/(.+)\/([gimsuy]*)$/);
  if (slash) {
    try {
      const flags = slash[2]!.includes("i") ? slash[2]! : `${slash[2]!}i`;
      return {
        kind: "regex",
        re: new RegExp(slash[1]!, flags.replace("g", "")),
        source: slash[1]!,
      };
    } catch {
      return { kind: "literal", needle: q.toLowerCase() };
    }
  }
  if (/^re:/i.test(q)) {
    const src = q.slice(3).trim();
    if (!src) return { kind: "literal", needle: "" };
    try {
      return { kind: "regex", re: new RegExp(src, "i"), source: src };
    } catch {
      return { kind: "literal", needle: src.toLowerCase() };
    }
  }
  return { kind: "literal", needle: q.toLowerCase() };
}

/** Context window on a single line, with the match position inside it. */
export function buildContextLine(
  line: string,
  matchIndex: number,
  matchLength: number,
  max = WORKSPACE_SEARCH_CONTEXT_CHARS
): { context: string; matchStart: number; matchLength: number } {
  const raw = line.replace(/\t/g, "  ");
  // Tabs expand, so remap the match offset onto the expanded string.
  const tabShift = line.slice(0, matchIndex).replace(/[^\t]/g, "").length;
  const start = matchIndex + tabShift;
  const len = Math.max(1, matchLength);
  const leading = raw.slice(0, start);
  const indent = leading.length - leading.trimStart().length;
  const trimmedStart = indent;
  const body = raw.slice(trimmedStart).replace(/\s+$/, "");
  const relStart = Math.max(0, start - trimmedStart);
  if (body.length <= max) {
    return { context: body, matchStart: relStart, matchLength: len };
  }
  const pad = Math.max(24, Math.floor((max - len) / 2));
  let from = Math.max(0, relStart - pad);
  const to = Math.min(body.length, from + max);
  if (to - from < max) from = Math.max(0, to - max);
  const slice = body.slice(from, to);
  return {
    context: `${from > 0 ? "…" : ""}${slice}${to < body.length ? "…" : ""}`,
    matchStart: relStart - from + (from > 0 ? 1 : 0),
    matchLength: len,
  };
}

function matchesOnLine(
  line: string,
  query: ParsedQuery
): { index: number; length: number } | null {
  if (query.kind === "literal") {
    if (!query.needle) return null;
    const i = line.toLowerCase().indexOf(query.needle);
    return i < 0 ? null : { index: i, length: query.needle.length };
  }
  const m = query.re.exec(line);
  if (!m || m.index == null) return null;
  return { index: m.index, length: Math.max(1, m[0].length) };
}

export function searchTextInFile(
  path: string,
  content: string,
  rawQuery: string,
  opts?: { maxMatches?: number }
): WorkspaceSearchHit[] {
  const query = parseWorkspaceQueryPattern(rawQuery);
  if (query.kind === "literal" && !query.needle) return [];
  const max = Math.max(1, opts?.maxMatches ?? WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE);
  const out: WorkspaceSearchHit[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i]!;
    if (line.length > 4000) continue; // minified bundles
    const hit = matchesOnLine(line, query);
    if (!hit) continue;
    const ctx = buildContextLine(line, hit.index, hit.length);
    out.push({
      path,
      line: i + 1,
      context: ctx.context,
      matchStart: ctx.matchStart,
      matchLength: ctx.matchLength,
    });
  }
  return out;
}

/** Looks binary without decoding: NUL byte in the first chunk. */
export function looksBinary(content: string): boolean {
  const probe = content.slice(0, 2048);
  for (let i = 0; i < probe.length; i++) {
    if (probe.charCodeAt(i) === 0) return true;
  }
  return false;
}

/**
 * Walk the project breadth-first (bounded), grepping each text file.
 * Reports progress so the UI can show「扫描中 · 已扫 N 个文件」.
 */
export async function searchWorkspace(opts: {
  query: string;
  io: WorkspaceSearchIo;
  maxFiles?: number;
  maxHits?: number;
  maxDepth?: number;
  maxFileBytes?: number;
  signal?: { cancelled: boolean };
  onProgress?: (state: { scanned: number; hits: number }) => void;
}): Promise<WorkspaceSearchResult> {
  const query = parseWorkspaceQuery(opts.query);
  const result: WorkspaceSearchResult = {
    hits: [],
    scannedFiles: 0,
    skippedFiles: 0,
    truncated: false,
  };
  if (!query) return result;

  const maxFiles = Math.max(1, opts.maxFiles ?? WORKSPACE_SEARCH_MAX_FILES);
  const maxHits = Math.max(1, opts.maxHits ?? WORKSPACE_SEARCH_MAX_HITS);
  const maxDepth = Math.max(0, opts.maxDepth ?? WORKSPACE_SEARCH_MAX_DEPTH);
  const maxBytes = Math.max(1024, opts.maxFileBytes ?? WORKSPACE_SEARCH_MAX_FILE_BYTES);

  const queue: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];
  const seenDirs = new Set<string>();

  while (queue.length > 0) {
    if (opts.signal?.cancelled) {
      result.truncated = true;
      break;
    }
    const { dir, depth } = queue.shift()!;
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    let entries: IdeFsEntry[];
    try {
      entries = await opts.io.listDir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (opts.signal?.cancelled) break;
      if (shouldIgnoreName(entry.name)) continue;

      if (entry.kind === "directory") {
        if (depth >= maxDepth) {
          result.truncated = true;
          continue;
        }
        queue.push({ dir: entry.path, depth: depth + 1 });
        continue;
      }

      if (!isLikelyTextPath(entry.path)) {
        result.skippedFiles += 1;
        continue;
      }
      if (result.scannedFiles >= maxFiles) {
        result.truncated = true;
        break;
      }

      let body: { content: string; bytes?: number };
      try {
        body = await opts.io.readFile(entry.path);
      } catch {
        result.skippedFiles += 1;
        continue;
      }
      if ((body.bytes ?? body.content.length) > maxBytes) {
        result.skippedFiles += 1;
        continue;
      }
      if (looksBinary(body.content)) {
        result.skippedFiles += 1;
        continue;
      }

      result.scannedFiles += 1;
      const found = searchTextInFile(entry.path, body.content, query);
      if (found.length > 0) {
        result.hits.push(...found);
        if (result.hits.length > maxHits) {
          result.hits = result.hits.slice(0, maxHits);
          result.truncated = true;
          break;
        }
      }
      opts.onProgress?.({ scanned: result.scannedFiles, hits: result.hits.length });
    }

    if (result.truncated) break;
  }

  result.hits.sort(
    (a, b) => a.path.localeCompare(b.path, "en") || a.line - b.line
  );
  return result;
}

/** Default IO built on the explorer's own directory APIs. */
export function workspaceSearchIo(
  session: IdeFolderSession,
  listDir: (s: IdeFolderSession, relDir: string) => Promise<IdeFsEntry[]>,
  readFile: (s: IdeFolderSession, relPath: string) => Promise<string>
): WorkspaceSearchIo {
  return {
    listDir: (relDir) => listDir(session, relDir),
    readFile: async (relPath) => {
      const content = await readFile(session, relPath);
      return { content, bytes: content.length };
    },
  };
}
