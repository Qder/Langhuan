/**
 * 讲解 / 选区 → 阁里的笔记。
 *
 * Only pure markdown building lives here; writing goes through the existing
 * notes store (`createDoc` / `setDraft` + `saveDoc`), never a new storage layer.
 *
 * Layout:
 *   读码笔记/<工程名>/<YYYY-MM-DD>-<文件名>.md   每条讲解一篇
 *   读码笔记/速记.md                             选区速记，追加成块
 */

import { basename, normalizeNewlines } from "../utils";
import { normalizeIdeRelPath } from "./citations";
import { formatIdeLink } from "./ideLink";

export const IDE_NOTE_ROOT = "读码笔记";
export const IDE_SNIPPET_NOTE_NAME = "速记.md";
export const SNIPPET_MAX_LINES = 80;
export const SNIPPET_MAX_CHARS = 6000;
export const EXPLAIN_NOTE_MAX_CHARS = 200_000;

/** Filesystem-safe single path segment (never empty). */
export function sanitizeNoteSegment(raw: string, fallback = "未命名"): string {
  const cleaned = String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  // A segment made only of punctuation would be a useless (or reserved) name.
  if (!cleaned || /^[-_.\s]+$/.test(cleaned)) return fallback;
  return cleaned;
}

/** Human title: keeps quotes / punctuation, only flattens whitespace. */
export function sanitizeNoteTitle(raw: string, fallback = "讲解"): string {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

/** `2026-11-04` in local time (not UTC — the note date should match the desk). */
export function noteDateStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `src/foo/Bar.java` → `Bar`; strips the extension for the note filename. */
export function noteFileStem(path: string): string {
  const leaf = basename(normalizeIdeRelPath(path));
  const stem = leaf.replace(/\.[A-Za-z0-9]+$/, "");
  return sanitizeNoteSegment(stem || leaf, "未命名");
}

/** 读码笔记/<工程>/YYYY-MM-DD-<文件名>.md */
export function explainNotePath(opts: {
  projectName?: string | null;
  sourcePath: string;
  date?: string;
}): string {
  const date = opts.date ?? noteDateStamp();
  const dir = [
    IDE_NOTE_ROOT,
    sanitizeNoteSegment(opts.projectName || "未命名工程", "未命名工程"),
  ].join("/");
  return `${dir}/${date}-${noteFileStem(opts.sourcePath)}.md`;
}

/** 读码笔记/速记.md */
export function snippetNotePath(): string {
  return `${IDE_NOTE_ROOT}/${IDE_SNIPPET_NOTE_NAME}`;
}

export type ExplainCitation = {
  path: string;
  line?: number;
  endLine?: number;
};

export type ExplainNoteInput = {
  question: string;
  answer: string;
  projectName?: string | null;
  /** File the turn was about (may be empty when nothing was open). */
  sourcePath?: string | null;
  citations?: ExplainCitation[];
  /** Chat message time; defaults to now. */
  createdAt?: number;
};

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One-line excerpt for the note title, without markdown noise. */
function titleFromQuestion(question: string): string {
  const flat = question
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitizeNoteTitle(flat.slice(0, 40), "讲解");
}

/**
 * Full markdown body for「收入藏书阁」: frontmatter, question, answer, and a
 * source block listing the project / file / cited path:line entries.
 */
export function buildExplainNote(input: ExplainNoteInput): string {
  const project = sanitizeNoteSegment(
    input.projectName || "未命名工程",
    "未命名工程"
  );
  const sourcePath = input.sourcePath
    ? normalizeIdeRelPath(input.sourcePath)
    : "";
  const question = String(input.question ?? "").trim() || "（未记录问题）";
  const answerRaw = normalizeNewlines(String(input.answer ?? "").trim());
  const answer =
    answerRaw.length > EXPLAIN_NOTE_MAX_CHARS
      ? `${answerRaw.slice(0, EXPLAIN_NOTE_MAX_CHARS)}\n\n> （回答过长，已截断）\n`
      : answerRaw || "（讲解没有返回内容）";
  const createdAt = input.createdAt ?? Date.now();
  const isoTs = new Date(createdAt).toISOString();

  const citeIndex = new Map<string, number>();
  const cites: ExplainCitation[] = [];
  for (const c of input.citations ?? []) {
    const path = normalizeIdeRelPath(c.path || "");
    if (!path) continue;
    // Dedupe by path + start line; a wider end line upgrades the kept entry.
    const key = `${path}\0${c.line ?? ""}`;
    const line = c.line != null && c.line > 0 ? Math.floor(c.line) : undefined;
    const endLine =
      c.endLine != null && c.endLine > 0 ? Math.floor(c.endLine) : undefined;
    const prevIndex = citeIndex.get(key);
    if (prevIndex != null) {
      const kept = cites[prevIndex]!;
      if (endLine != null && (kept.endLine == null || endLine > kept.endLine)) {
        cites[prevIndex] = { ...kept, endLine };
      }
      continue;
    }
    citeIndex.set(key, cites.length);
    cites.push({ path, line, endLine });
  }

  const lines: string[] = [
    "---",
    `title: ${yamlString(titleFromQuestion(question))}`,
    "tags: [读码]",
    `created: ${isoTs}`,
    "---",
    "",
    `# ${titleFromQuestion(question)}`,
    "",
    `- 工程：**${project}**`,
  ];
  if (sourcePath) {
    lines.push(`- 文件：\`${sourcePath}\` · ${formatIdeLink(sourcePath)}`);
  }
  lines.push(`- 收入时间：${isoTs.replace("T", " ").slice(0, 16)}`);
  lines.push("", "## 问题", "", question, "", "## 讲解", "", answer, "");

  if (cites.length > 0) {
    lines.push("## 引用");
    lines.push("");
    for (const c of cites) {
      const label =
        c.line == null
          ? c.path
          : c.endLine != null && c.endLine > c.line
            ? `${c.path}:${c.line}-${c.endLine}`
            : `${c.path}:${c.line}`;
      lines.push(`- \`${label}\` · ${formatIdeLink(c.path, c.line, c.endLine)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`;
}

export type SnippetTruncation = {
  text: string;
  /** When true the block carries a「已截断」note. */
  truncated: boolean;
  totalLines: number;
  totalChars: number;
};

/** Cap a selection for a 速记 block so one paste cannot swallow the note. */
export function truncateSnippet(
  raw: string,
  opts?: { maxLines?: number; maxChars?: number }
): SnippetTruncation {
  const maxLines = opts?.maxLines ?? SNIPPET_MAX_LINES;
  const maxChars = opts?.maxChars ?? SNIPPET_MAX_CHARS;
  const text = normalizeNewlines(String(raw ?? "")).replace(/\s+$/, "");
  const lines = text.split("\n");
  const totalLines = lines.length;
  const totalChars = text.length;
  if (totalLines <= maxLines && totalChars <= maxChars) {
    return { text, truncated: false, totalLines, totalChars };
  }
  let kept = lines.slice(0, maxLines).join("\n");
  if (kept.length > maxChars) kept = kept.slice(0, maxChars);
  return { text: kept, truncated: true, totalLines, totalChars };
}

/** Pick a fence long enough that the snippet cannot break out of it. */
export function safeFence(text: string): string {
  let fence = "```";
  while (text.includes(fence)) fence += "`";
  return fence;
}

export type SnippetBlockInput = {
  path: string;
  fromLine: number;
  toLine: number;
  text: string;
  /** Language tag for the fence; omit for a bare fence. */
  lang?: string;
  /** Extra note appended after the fence (e.g. origin). */
  note?: string;
};

/** `### \`src/foo.ts:12-20\`` + fenced body (+ truncation note). */
export function buildSnippetBlock(input: SnippetBlockInput): string {
  const path = normalizeIdeRelPath(input.path);
  const from = Math.max(1, Math.floor(input.fromLine || 1));
  const to = Math.max(from, Math.floor(input.toLine || from));
  const range = to > from ? `${from}-${to}` : `${from}`;
  const { text, truncated, totalLines, totalChars } = truncateSnippet(input.text);
  const fence = safeFence(text);
  const lang = (input.lang || "").trim();

  const parts: string[] = [
    `### \`${path}:${range}\``,
    "",
    `${fence}${lang}`,
    text,
    fence,
    "",
  ];
  if (truncated) {
    parts.push(
      `> 选区较长，已截断：保留前 ${text.split("\n").length} 行 / ${text.length} 字符（原始 ${totalLines} 行 / ${totalChars} 字符）。`,
      ""
    );
  }
  parts.push(`来源：${formatIdeLink(path, from, to)}`);
  if (input.note) parts.push("", input.note.trim());
  return parts.join("\n");
}

/** Header written once when 速记.md is created. */
export const SNIPPET_NOTE_HEADER = `# 速记

从读码选区收进来的代码片段，按时间倒序之外追加在文末；标题里的路径可以直接点回工程。

`;

/** Append a block to existing 速记 content (idempotent-friendly spacing). */
export function appendSnippetBlock(existing: string, block: string): string {
  const body = normalizeNewlines(existing || "");
  const trimmed = body.replace(/\s+$/, "");
  const head = trimmed.length > 0 ? trimmed : SNIPPET_NOTE_HEADER.trimEnd();
  return `${head}\n\n${block.replace(/\s+$/, "")}\n`;
}
