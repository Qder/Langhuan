/**
 * Note–source citations stored in the note body (Step 6).
 *
 * A `lh-cite` fence keeps project id, relative path, line range, a snapshot of
 * the selected source at link time, and an optional personal comment. Because
 * it is ordinary markdown, save / move / delete (Step 2), library persist
 * (Step 3), and zip backup/restore (Step 4) already cover it — no sidecar and
 * no IDB-only store. Step 7 topics can reuse the same shape later.
 */

import { normalizeIdeRelPath, isIdeCitationPath } from "./citations";

export const NOTE_SOURCE_CITE_LANG = "lh-cite";

/** Same caps as 速记, kept here so this module does not import captureNote. */
export const CITE_SNAPSHOT_MAX_LINES = 80;
export const CITE_SNAPSHOT_MAX_CHARS = 6000;

function safeFence(text: string): string {
  let fence = "```";
  while (text.includes(fence)) fence += "`";
  return fence;
}

function clipSnapshot(raw: string): { text: string; truncated: boolean } {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const lines = text.split("\n");
  if (
    lines.length <= CITE_SNAPSHOT_MAX_LINES &&
    text.length <= CITE_SNAPSHOT_MAX_CHARS
  ) {
    return { text, truncated: false };
  }
  let kept = lines.slice(0, CITE_SNAPSHOT_MAX_LINES).join("\n");
  if (kept.length > CITE_SNAPSHOT_MAX_CHARS) kept = kept.slice(0, CITE_SNAPSHOT_MAX_CHARS);
  return { text: kept, truncated: true };
}

export type NoteSourceCitation = {
  projectId: string;
  path: string;
  fromLine: number;
  toLine: number;
  snapshot: string;
  note?: string;
  capturedAt?: number;
  /** Display-only; not required to jump. */
  projectName?: string;
  truncated?: boolean;
};

export type NoteSourceCitationInput = {
  projectId: string;
  path: string;
  fromLine: number;
  toLine: number;
  snapshot: string;
  note?: string | null;
  capturedAt?: number;
  projectName?: string | null;
};

export type ParsedNoteSourceCitation = {
  citation: NoteSourceCitation;
  /** Offset of the opening fence in the note body. */
  index: number;
  endIndex: number;
  raw: string;
};

function posLine(n: number, fallback = 1): number {
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function escapeField(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "");
}

function unescapeField(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "\\") {
      out += "\\";
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

export function buildNoteSourceCitation(
  input: NoteSourceCitationInput
): NoteSourceCitation {
  const path = normalizeIdeRelPath(input.path);
  const fromLine = posLine(input.fromLine);
  const toLine = Math.max(fromLine, posLine(input.toLine, fromLine));
  const clipped = clipSnapshot(String(input.snapshot ?? ""));
  const note = String(input.note ?? "").trim();
  const projectName = String(input.projectName ?? "").trim();
  return {
    projectId: String(input.projectId ?? "").trim(),
    path,
    fromLine,
    toLine,
    snapshot: clipped.text,
    truncated: clipped.truncated || undefined,
    note: note || undefined,
    capturedAt: Number.isFinite(input.capturedAt)
      ? Math.floor(input.capturedAt as number)
      : Date.now(),
    projectName: projectName || undefined,
  };
}

/** Serialize one citation as a self-contained `lh-cite` fence. */
export function formatNoteSourceCitationBlock(
  input: NoteSourceCitation | NoteSourceCitationInput
): string {
  const c = "snapshot" in input && input.snapshot != null
    ? buildNoteSourceCitation(input)
    : buildNoteSourceCitation(input);
  const linesRange =
    c.toLine > c.fromLine ? `${c.fromLine}-${c.toLine}` : `${c.fromLine}`;
  const headers = [
    `project: ${c.projectId}`,
    `path: ${c.path}`,
    `lines: ${linesRange}`,
  ];
  if (c.capturedAt != null) {
    headers.push(`capturedAt: ${new Date(c.capturedAt).toISOString()}`);
  }
  if (c.projectName) headers.push(`projectName: ${escapeField(c.projectName)}`);
  if (c.truncated) headers.push("truncated: true");
  if (c.note) headers.push(`note: ${escapeField(c.note)}`);
  const body = `${headers.join("\n")}\n\n${c.snapshot.replace(/\n$/, "")}`;
  const fence = safeFence(body);
  return `${fence}${NOTE_SOURCE_CITE_LANG}\n${body}\n${fence}`;
}

function parseLinesField(raw: string): { fromLine: number; toLine: number } | null {
  const m = String(raw ?? "").trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const fromLine = posLine(Number.parseInt(m[1]!, 10));
  const toLine = m[2] ? Math.max(fromLine, posLine(Number.parseInt(m[2], 10), fromLine)) : fromLine;
  return { fromLine, toLine };
}

/** Parse the body of a single `lh-cite` fence (no surrounding backticks). */
export function parseNoteSourceCitationBody(
  raw: string
): NoteSourceCitation | null {
  const text = String(raw ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.trim()) return null;
  const sep = text.indexOf("\n\n");
  const head = sep >= 0 ? text.slice(0, sep) : text;
  const snapshot = sep >= 0 ? text.slice(sep + 2).replace(/\n$/, "") : "";
  const fields: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const cut = line.indexOf(":");
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim();
    if (!key) continue;
    fields[key] = value;
  }
  const projectId = (fields.project || "").trim();
  const path = normalizeIdeRelPath(fields.path || "");
  const range = parseLinesField(fields.lines || "");
  if (!projectId || !path || !isIdeCitationPath(path) || !range) return null;
  const capturedAt = fields.capturedAt
    ? Date.parse(fields.capturedAt)
    : undefined;
  const note = fields.note ? unescapeField(fields.note).trim() : "";
  const projectName = fields.projectName
    ? unescapeField(fields.projectName).trim()
    : "";
  return {
    projectId,
    path,
    fromLine: range.fromLine,
    toLine: range.toLine,
    snapshot,
    note: note || undefined,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : undefined,
    projectName: projectName || undefined,
    truncated: fields.truncated === "true" || undefined,
  };
}

const CITE_FENCE_RE =
  /^(`{3,})lh-cite[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm;

/** Extract every `lh-cite` fence in a note body, in document order. */
export function parseNoteSourceCitations(
  markdown: string
): ParsedNoteSourceCitation[] {
  if (!markdown) return [];
  const out: ParsedNoteSourceCitation[] = [];
  const re = new RegExp(CITE_FENCE_RE.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const citation = parseNoteSourceCitationBody(m[2] || "");
    if (!citation) continue;
    out.push({
      citation,
      index: m.index,
      endIndex: m.index + m[0].length,
      raw: m[0],
    });
  }
  return out;
}

