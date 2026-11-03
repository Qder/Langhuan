/**
 * Locate an explain-panel code fence against attached / open file bodies.
 * Does not invent paths; unique substring first, then whitespace-collapsed.
 * Multiple hits are returned in order — the UI cycles, it does not guess.
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

export type SnippetHit = {
  path: string;
  line: number;
  endLine: number;
  precision: "exact" | "whitespace";
};

export type SnippetLocateOk = {
  ok: true;
  path: string;
  line: number;
  endLine: number;
  precision: "exact" | "whitespace";
  hits: SnippetHit[];
};

export type SnippetLocateMiss = {
  ok: false;
  reason: "empty" | "too-short" | "miss";
  candidates: string[];
  hits: [];
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

function toHit(h: RawHit): SnippetHit {
  const line = lineAtOffset(h.content, h.start, h.startLine);
  const last = Math.max(h.start, h.end - 1);
  const endLine = lineAtOffset(h.content, last, h.startLine);
  return {
    path: h.path,
    line,
    endLine: Math.max(line, endLine),
    precision: h.precision,
  };
}

function toResult(hits: RawHit[]): SnippetLocateResult {
  if (hits.length === 0) return { ok: false, reason: "miss", candidates: [], hits: [] };
  const mapped = hits.map(toHit);
  const first = mapped[0]!;
  return {
    ok: true,
    path: first.path,
    line: first.line,
    endLine: first.endLine,
    precision: first.precision,
    hits: mapped,
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
 * Several hits are all returned in document order (caller cycles).
 */
export function locateSnippetInFiles(
  snippet: string,
  files: SnippetFile[]
): SnippetLocateResult {
  const needle = normalizeSnippetBody(snippet).trim();
  if (!needle) return { ok: false, reason: "empty", candidates: [], hits: [] };

  const collapsedNeedle = collapseWs(needle).text;
  if (collapsedNeedle.length < SNIPPET_MIN_COLLAPSED_CHARS) {
    return { ok: false, reason: "too-short", candidates: [], hits: [] };
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
  if (exact.ok) return exact;

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

/**
 * True when `snippet` occurs inside the cited 1-based line range of `file`.
 * Uses the same exact-then-whitespace rules as locate.
 */
export function snippetInCitedRange(
  snippet: string,
  file: SnippetFile,
  line: number,
  endLine?: number
): boolean {
  const startLine = file.startLine ?? 1;
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  const from = Math.max(1, Math.floor(line));
  const to = Math.max(from, Math.floor(endLine ?? line));
  const sliceFrom = Math.max(0, from - startLine);
  const sliceTo = Math.min(lines.length, to - startLine + 1);
  if (sliceFrom >= sliceTo) return false;
  const window = lines.slice(sliceFrom, sliceTo).join("\n");
  const r = locateSnippetInFiles(snippet, [
    {
      path: file.path,
      content: window,
      startLine: startLine + sliceFrom,
    },
  ]);
  return r.ok;
}

/** Merge message corpus then open tabs; first path wins. */
export function mergeSnippetCorpus(
  primary: SnippetFile[] | undefined,
  tabs: SnippetFile[] | undefined
): SnippetFile[] {
  return dedupeFiles([...(primary || []), ...(tabs || [])]);
}

/** Overlay paths replace earlier entries (full file over truncated snapshot). */
export function overlaySnippetCorpus(
  base: SnippetFile[],
  overlay: SnippetFile[]
): SnippetFile[] {
  return dedupeFiles([...overlay, ...base]);
}

/** Footer / chrome label: path:line, or the first non-empty source line. */
export function fenceChipLabel(f: ExplainFence, max = 28): string {
  if (f.path) {
    const base = f.path.split("/").pop() || f.path;
    if (f.line == null) return base;
    if (f.endLine != null && f.endLine !== f.line) {
      return `${base}:${f.line}-${f.endLine}`;
    }
    return `${base}:${f.line}`;
  }
  const first = f.body.split("\n").find((l) => l.trim())?.trim() || "代码块";
  if (first.length <= max) return first;
  return `${first.slice(0, Math.max(1, max - 1))}…`;
}
