/**
 * 讲解 / 选区 → 阁里的笔记。
 *
 * Only pure markdown building lives here; writing goes through the existing
 * notes store (`createDoc` / `setDraft` + `saveDoc`), never a new storage layer.
 *
 * Layout:
 *   读码笔记/<工程名>/<YYYY-MM-DD>-<文件名>.md   当天该文件的所有讲解
 *   读码笔记/速记.md                             选区速记，追加成块
 *
 * One day + one file is one note. Capturing the same file again on the same day
 * appends a `## HH:mm · …` section instead of creating `-2.md`, so the desk
 * accumulates one readable note per file per day rather than a pile of look-alike
 * files.
 */

import { basename, normalizeNewlines } from "../utils";
import { normalizeIdeRelPath } from "./citations";
import { formatIdeLink } from "./ideLink";

export const IDE_NOTE_ROOT = "读码笔记";
export const IDE_SNIPPET_NOTE_NAME = "速记.md";
/** 讲解空态 / 设置里用的落盘说明（2–3 行）。目录约定只这一处。 */
export const IDE_NOTE_DESTINATION_HINT = [
  "「收入藏书阁」写到 读码笔记/<工程>/YYYY-MM-DD-<文件名>.md；当天同一文件再收入会追加一节，不会新建 -2.md。",
  "「收入本段」把当前对话整篇写到 读码笔记/<工程>/YYYY-MM-DD-讲解-<短标题>.md；再点一次整篇刷新，不重复抄。",
  "「速记」追加到 读码笔记/速记.md。",
  "工程源码不会写进 content 根或其他乱七八糟的位置。",
].join("\n");

export function isIdeNoteRootFolder(folderPath: string): boolean {
  return folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") === IDE_NOTE_ROOT;
}
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

/** `14:05` in local time — the section heading for an appended explain turn. */
export function noteTimeStamp(now: Date = new Date()): string {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * `2026-11-04 14:05` in local time. Notes are read at the desk, so the clock in
 * the body must match the clock in the filename (never a UTC shift).
 */
export function noteLocalStamp(now: Date = new Date()): string {
  return `${noteDateStamp(now)} ${noteTimeStamp(now)}`;
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
  /** Where to jump when the file link is clicked; falls back to the first cite. */
  sourceLine?: number;
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

/** Normalized, deduped, line-bearing citations (pure, shared by both bodies). */
function normalizeCites(list: ExplainCitation[] | undefined): ExplainCitation[] {
  const index = new Map<string, number>();
  const cites: ExplainCitation[] = [];
  for (const c of list ?? []) {
    const path = normalizeIdeRelPath(c.path || "");
    if (!path) continue;
    // Dedupe by path + start line; a wider end line upgrades the kept entry.
    const key = `${path}\0${c.line ?? ""}`;
    const line = c.line != null && c.line > 0 ? Math.floor(c.line) : undefined;
    const endLine =
      c.endLine != null && c.endLine > 0 ? Math.floor(c.endLine) : undefined;
    const prevIndex = index.get(key);
    if (prevIndex != null) {
      const kept = cites[prevIndex]!;
      if (endLine != null && (kept.endLine == null || endLine > kept.endLine)) {
        cites[prevIndex] = { ...kept, endLine };
      }
      continue;
    }
    index.set(key, cites.length);
    cites.push({ path, line, endLine });
  }
  return cites;
}

/**
 * Line the file link should land on: the explicit hint, else the earliest cited
 * line *inside that file*. Never borrows another file's line number.
 */
function sourceLinkLine(
  sourcePath: string,
  input: ExplainNoteInput,
  cites: ExplainCitation[]
): number | undefined {
  const explicit =
    input.sourceLine != null && input.sourceLine > 0
      ? Math.floor(input.sourceLine)
      : undefined;
  if (explicit != null) return explicit;
  const own = cites
    .filter((c) => c.path === sourcePath && c.line != null)
    .map((c) => c.line!)
    .sort((a, b) => a - b);
  return own[0];
}

function citeLines(cites: ExplainCitation[]): string[] {
  const out: string[] = [];
  for (const c of cites) {
    const label =
      c.line == null
        ? c.path
        : c.endLine != null && c.endLine > c.line
          ? `${c.path}:${c.line}-${c.endLine}`
          : `${c.path}:${c.line}`;
    out.push(`- \`${label}\` · ${formatIdeLink(c.path, c.line, c.endLine)}`);
  }
  return out;
}

/**
 * Section appended when the same file is captured again on the same day.
 * Starts at `##` so it reads as a peer of the first turn, and carries its own
 * timestamp + jump link — an append must stay locatable months later.
 */
export function buildExplainSection(input: ExplainNoteInput): string {
  const question = String(input.question ?? "").trim() || "（未记录问题）";
  const answerRaw = normalizeNewlines(String(input.answer ?? "").trim());
  const answer =
    answerRaw.length > EXPLAIN_NOTE_MAX_CHARS
      ? `${answerRaw.slice(0, EXPLAIN_NOTE_MAX_CHARS)}\n\n> （回答过长，已截断）\n`
      : answerRaw || "（讲解没有返回内容）";
  const createdAt = input.createdAt ?? Date.now();
  const stamp = new Date(createdAt);
  const cites = normalizeCites(input.citations);
  const sourcePath = input.sourcePath
    ? normalizeIdeRelPath(input.sourcePath)
    : "";
  const line = sourcePath ? sourceLinkLine(sourcePath, input, cites) : undefined;

  const lines: string[] = [
    `## ${noteTimeStamp(stamp)} · ${titleFromQuestion(question)}`,
    "",
    `- 收入时间：${noteLocalStamp(stamp)}`,
  ];
  if (sourcePath) {
    lines.push(`- 文件：\`${sourcePath}\` · ${formatIdeLink(sourcePath, line)}`);
  }
  lines.push("", "### 问题", "", question, "", "### 讲解", "", answer, "");
  if (cites.length > 0) {
    lines.push("### 引用", "", ...citeLines(cites), "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Append a section to an existing note body, keeping blank-line discipline. */
export function appendExplainSection(existing: string, section: string): string {
  const head = normalizeNewlines(existing || "").replace(/\s+$/, "");
  const tail = normalizeNewlines(section || "").trim();
  if (!head) return `${tail}\n`;
  if (!tail) return `${head}\n`;
  return `${head}\n\n${tail}\n`;
}

/**
 * Full markdown body for the *first*「收入藏书阁」of a file on a given day:
 * frontmatter, question, answer, and the project / file / cited path:line block.
 * Later captures that day go through `appendExplainSection`.
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
  const stamp = new Date(createdAt);
  const isoTs = stamp.toISOString();
  const cites = normalizeCites(input.citations);
  const line = sourcePath ? sourceLinkLine(sourcePath, input, cites) : undefined;

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
    lines.push(`- 文件：\`${sourcePath}\` · ${formatIdeLink(sourcePath, line)}`);
  }
  lines.push(`- 收入时间：${noteLocalStamp(stamp)}`);
  lines.push("", "## 问题", "", question, "", "## 讲解", "", answer, "");

  if (cites.length > 0) {
    lines.push("## 引用", "", ...citeLines(cites), "");
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

从读码选区收进来的代码片段，按收入顺序追加在文末；每条标题里的路径和「来源」都能点回工程对应行。

`;

/** Append a block to existing 速记 content (idempotent-friendly spacing). */
export function appendSnippetBlock(existing: string, block: string): string {
  const body = normalizeNewlines(existing || "");
  const trimmed = body.replace(/\s+$/, "");
  const head = trimmed.length > 0 ? trimmed : SNIPPET_NOTE_HEADER.trimEnd();
  return `${head}\n\n${block.replace(/\s+$/, "")}\n`;
}

/* ------------------------------------------------------------------ *
 * 整段对话（当前 thread）→ 一篇笔记
 *
 * 单条收入是「一天一个文件、再收入就追加一节」；整段对话相反：一个 thread
 * 一篇，同一天再点收入**整篇覆盖**，否则每点一次就把同样的问答再抄一遍。
 * 文件名带上 `-讲解-` 前缀，和单条（YYYY-MM-DD-<文件名>.md）互不碰撞。
 * ------------------------------------------------------------------ */

/** 文件名里短标题的长度上限（汉字也算 1）。 */
export const EXPLAIN_THREAD_NOTE_TITLE_MAX = 16;

export type ExplainThreadTurn = {
  role: "user" | "assistant";
  content: string;
  /** 该轮的时间；用来分节和定文件名日期。 */
  createdAt?: number;
  citations?: ExplainCitation[];
};

/** 短标题：压平空白、去掉路径分隔符，截到 16 字，空则「讲解」。 */
export function explainThreadNoteShortTitle(raw: string): string {
  const flat = sanitizeNoteTitle(raw, "讲解")
    .replace(/^讲解\s*[·:：-]\s*/, "")
    .trim();
  const clipped =
    flat.length > EXPLAIN_THREAD_NOTE_TITLE_MAX
      ? flat.slice(0, EXPLAIN_THREAD_NOTE_TITLE_MAX)
      : flat;
  return sanitizeNoteSegment(clipped, "讲解").replace(/[-_\s]+$/, "") || "讲解";
}

/** 读码笔记/<工程>/YYYY-MM-DD-讲解-<短标题>.md */
export function explainThreadNotePath(opts: {
  projectName?: string | null;
  title: string;
  date?: string;
}): string {
  const date = opts.date ?? noteDateStamp();
  const dir = [
    IDE_NOTE_ROOT,
    sanitizeNoteSegment(opts.projectName || "未命名工程", "未命名工程"),
  ].join("/");
  return `${dir}/${date}-讲解-${explainThreadNoteShortTitle(opts.title)}.md`;
}

/** 这条路径是不是整段对话笔记（决定「可以整篇覆盖」）。 */
export function isExplainThreadNotePath(path: string): boolean {
  return /\/\d{4}-\d{2}-\d{2}-讲解-/.test(normalizeNewlines(path || ""));
}

function clipExplainBody(raw: string, emptyText: string): string {
  const text = normalizeNewlines(String(raw ?? "").trim());
  if (!text) return emptyText;
  return text.length > EXPLAIN_NOTE_MAX_CHARS
    ? `${text.slice(0, EXPLAIN_NOTE_MAX_CHARS)}\n\n> （内容过长，已截断）\n`
    : text;
}

/**
 * 整段对话的 markdown：frontmatter + 每轮「问题 / 讲解 / 引用」。
 *
 * 只写对话文本和引用路径，**不写** `files` 里的源码正文——工程源码不进笔记库。
 */
export function buildExplainThreadNote(input: {
  projectName?: string | null;
  title: string;
  turns: ExplainThreadTurn[];
  /** 收入时刻，默认现在。 */
  createdAt?: number;
}): string {
  const project = sanitizeNoteSegment(
    input.projectName || "未命名工程",
    "未命名工程"
  );
  const title = sanitizeNoteTitle(input.title, "讲解");
  const stamp = new Date(input.createdAt ?? Date.now());
  const rounds = input.turns.filter((t) => t.role === "user").length;

  const lines: string[] = [
    "---",
    `title: ${yamlString(`讲解 · ${title}`)}`,
    "tags: [读码, 讲解]",
    `created: ${stamp.toISOString()}`,
    "---",
    "",
    `# 讲解 · ${title}`,
    "",
    `- 工程：**${project}**`,
    `- 轮次：${rounds} 轮`,
    `- 收入时间：${noteLocalStamp(stamp)}`,
  ];

  let round = 0;
  for (const turn of input.turns) {
    if (turn.role === "user") {
      round += 1;
      const at = new Date(turn.createdAt ?? stamp.getTime());
      lines.push("", `## 第 ${round} 轮 · ${noteTimeStamp(at)}`, "", "### 问题", "");
      lines.push(clipExplainBody(turn.content, "（未记录问题）"));
      continue;
    }
    lines.push("", "### 讲解", "");
    lines.push(clipExplainBody(turn.content, "（讲解没有返回内容）"));
    const cites = normalizeCites(turn.citations);
    if (cites.length > 0) {
      lines.push("", "### 引用", "", ...citeLines(cites));
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
