/**
 * Locate an explain-panel code fence against attached / open file bodies.
 * Does not invent paths; unique substring first, then whitespace-collapsed.
 */

import {
  normalizeIdeRelPath,
  parseIdePathLineToken,
} from "./citations";

export const SNIPPET_MIN_COLLAPSED_CHARS = 12;

export type ExplainFence = {
  lang: string;
  info: string;
  body: string;
  index: number;
  endIndex: number;
  path?: string;
  line?: number;
  endLine?: number;
};

export type SnippetFile = {
  path: string;
  content: string;
  /** 1-based line of content[0] in the real file. */
  startLine?: number;
};

export type SnippetLocateOk = {
  ok: true;
  path: string;
  line: number;
  endLine: number;
  precision: "exact" | "whitespace";
};

export type SnippetLocateMiss = {
  ok: false;
  reason: "empty" | "too-short" | "ambiguous" | "miss";
  candidates: string[];
};

export type SnippetLocateResult = SnippetLocateOk | SnippetLocateMiss;

export function normalizeSnippetBody(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

/** Split markdown into fenced blocks; info token may be path[:line[-end]]. */
export function parseExplainFences(markdown: string): ExplainFence[] {
  if (!markdown) return [];
  const out: ExplainFence[] = [];
  const re = /^```([\w.+-]*)[ \t]*([^\n]*)\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const lang = m[1] || "";
    const info = (m[2] || "").trim();
    const body = normalizeSnippetBody(m[3] || "");
    const firstTok = info.split(/\s+/).filter(Boolean)[0] || "";
    const parsed = firstTok ? parseIdePathLineToken(firstTok) : null;
    out.push({
      lang,
      info,
      body,
      index: m.index,
      endIndex: m.index + m[0].length,
      path: parsed?.path,
      line: parsed?.line,
      endLine: parsed?.endLine,
    });
  }
  return out;
}

function lineAtOffset(content: string, offset: number, startLine = 1): number {
  const lim = Math.max(0, Math.min(offset, content.length));
  let line = startLine;
  for (let i = 0; i < lim; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function findAll(hay: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(1, needle.length);
  }
  return out;
}

function collapseWs(s: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  const n = s.length;
  let pendingSpace = false;
  let pendingAt = 0;
  while (i < n) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      if (chars.length) {
        pendingSpace = true;
        pendingAt = i;
      }
      i += 1;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      map.push(pendingAt);
      pendingSpace = false;
    }
    chars.push(ch);
    map.push(i);
    i += 1;
  }
  return { text: chars.join(""), map };
}

type RawHit = {
  path: string;
  start: number;
  end: number;
  content: string;
  startLine: number;
  precision: "exact" | "whitespace";
};

function toResult(hits: RawHit[]): SnippetLocateResult {
  if (hits.length === 0) return { ok: false, reason: "miss", candidates: [] };
  const paths = [...new Set(hits.map((h) => h.path))];
  if (hits.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: paths.slice(0, 5) };
  }
  const h = hits[0]!;
  const line = lineAtOffset(h.content, h.start, h.startLine);
  const last = Math.max(h.start, h.end - 1);
  const endLine = lineAtOffset(h.content, last, h.startLine);
  return {
    ok: true,
    path: h.path,
    line,
    endLine: Math.max(line, endLine),
    precision: h.precision,
  };
}

function dedupeFiles(files: SnippetFile[]): SnippetFile[] {
  const seen = new Set<string>();
  const out: SnippetFile[] = [];
  for (const f of files) {
    const path = normalizeIdeRelPath(f.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      content: f.content.replace(/\r\n/g, "\n"),
      startLine: f.startLine ?? 1,
    });
  }
  return out;
}

/**
 * Unique substring locate. Exact match first; then whitespace-collapsed.
 * Multiple hits (same or different files) → ambiguous, do not guess.
 */
export function locateSnippetInFiles(
  snippet: string,
  files: SnippetFile[]
): SnippetLocateResult {
  const needle = normalizeSnippetBody(snippet).trim();
  if (!needle) return { ok: false, reason: "empty", candidates: [] };

  const collapsedNeedle = collapseWs(needle).text;
  if (collapsedNeedle.length < SNIPPET_MIN_COLLAPSED_CHARS) {
    return { ok: false, reason: "too-short", candidates: [] };
  }

  const corpus = dedupeFiles(files);
  const exactHits: RawHit[] = [];
  for (const f of corpus) {
    for (const start of findAll(f.content, needle)) {
      exactHits.push({
        path: f.path,
        start,
        end: start + needle.length,
        content: f.content,
        startLine: f.startLine ?? 1,
        precision: "exact",
      });
    }
  }
  const exact = toResult(exactHits);
  if (exact.ok || exact.reason === "ambiguous") return exact;

  const wsHits: RawHit[] = [];
  for (const f of corpus) {
    const col = collapseWs(f.content);
    if (!col.text) continue;
    for (const cStart of findAll(col.text, collapsedNeedle)) {
      const origStart = col.map[cStart] ?? 0;
      const origEndIdx = col.map[cStart + collapsedNeedle.length - 1] ?? origStart;
      wsHits.push({
        path: f.path,
        start: origStart,
        end: origEndIdx + 1,
        content: f.content,
        startLine: f.startLine ?? 1,
        precision: "whitespace",
      });
    }
  }
  return toResult(wsHits);
}

/** Merge message corpus then open tabs; first path wins. */
export function mergeSnippetCorpus(
  primary: SnippetFile[] | undefined,
  tabs: SnippetFile[] | undefined
): SnippetFile[] {
  return dedupeFiles([...(primary || []), ...(tabs || [])]);
}
