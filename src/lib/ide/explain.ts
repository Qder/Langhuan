/**
 * IDE explain: context trim, mock reply, session helpers.
 * No auto-edit; citations only.
 */

import { parseIdeCitations, normalizeIdeRelPath } from "./citations";

export const IDE_EXPLAIN_MAX_FULL_LINES = 400;
export const IDE_EXPLAIN_CONTEXT_PAD = 80;
export const IDE_EXPLAIN_HISTORY_MAX = 20;

export type IdeExplainFilePayload = {
  path: string;
  content: string;
  /** 1-based line number of content[0] in the real file. */
  startLine?: number;
};

export type IdeExplainSelection = {
  /** 1-based inclusive. */
  fromLine: number;
  toLine: number;
  text?: string;
};

export type IdeExplainMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed citation paths snapshot (no secrets). */
  citations?: Array<{ path: string; line?: number; endLine?: number }>;
  mock?: boolean;
  createdAt: number;
};

export const IDE_EXPLAIN_SYSTEM_PROMPT = `你是本工程的讲解助教，只解释知识点，不改代码、不输出 git patch、不编造工程里没有的路径。
每个关键结论请用 [[相对路径:行号]] 或 [[相对路径:起始行-结束行]] 标出源码位置（路径用工程相对路径，含目录）。
用简洁中文回答。`;

/**
 * Build file payloads for the model. Never sends the whole project tree.
 * Large files (>400 lines): selection±80, or head truncate when no selection.
 */
export function buildExplainFilePayloads(opts: {
  path: string;
  content: string;
  includeFile: boolean;
  includeSelection: boolean;
  selection?: IdeExplainSelection | null;
}): IdeExplainFilePayload[] {
  if (!opts.includeFile && !opts.includeSelection) return [];
  const path = normalizeIdeRelPath(opts.path);
  const lines = opts.content.split("\n");
  const total = lines.length;
  const sel = opts.selection;

  if (opts.includeSelection && sel && sel.fromLine >= 1) {
    const from = Math.max(1, Math.floor(sel.fromLine));
    const to = Math.max(from, Math.floor(sel.toLine || sel.fromLine));
    if (opts.includeFile && total <= IDE_EXPLAIN_MAX_FULL_LINES) {
      return [{ path, content: opts.content, startLine: 1 }];
    }
    const start = Math.max(1, from - IDE_EXPLAIN_CONTEXT_PAD);
    const end = Math.min(total, to + IDE_EXPLAIN_CONTEXT_PAD);
    return [
      {
        path,
        content: lines.slice(start - 1, end).join("\n"),
        startLine: start,
      },
    ];
  }

  if (!opts.includeFile) return [];

  if (total <= IDE_EXPLAIN_MAX_FULL_LINES) {
    return [{ path, content: opts.content, startLine: 1 }];
  }

  // Large file, no selection: send a head window only (never whole tree / whole file).
  const end = Math.min(total, IDE_EXPLAIN_CONTEXT_PAD * 2);
  return [
    {
      path,
      content:
        lines.slice(0, end).join("\n") +
        `\n\n/* … 已截断，全文 ${total} 行；请结合选区再问 … */`,
      startLine: 1,
    },
  ];
}

/** Deterministic mock explain that always cites the given path with a line. */
export function buildMockExplainMarkdown(opts: {
  question: string;
  files: IdeExplainFilePayload[];
}): string {
  const primary = opts.files[0];
  const path = primary?.path || "src/Main.java";
  const body = primary?.content || "";
  const lines = body.split("\n");
  const startLine = primary?.startLine ?? 1;
  // Prefer a non-empty line near the top of the snippet.
  let rel = 0;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (lines[i]?.trim()) {
      rel = i;
      break;
    }
  }
  const line = startLine + rel;
  const endLine = Math.min(line + 2, startLine + Math.max(0, lines.length - 1));
  const leaf = path.split("/").pop() || path;
  const q = (opts.question || "").trim() || "这个文件在讲什么";

  return [
    `这是针对「${q}」的本地示例讲解（未配置 API）。`,
    `文件 [[${path}:${line}]]（\`${leaf}\`）是当前上下文的入口；可以从这一带的定义读起。`,
    `若这段逻辑跨了几行，请看 [[${path}:${line}-${endLine}]]：先分清输入、状态和出口，再对照调用方。`,
    `点上面的路径芯片会打开工程里的真实文件并滚到对应行；编造路径不会静默乱开。`,
    `配置 \`OPENAI_API_KEY\`（或 IDE 设置里的 Key）后，这里会换成模型流式答复，引用格式不变。`,
  ].join("\n\n");
}

export function mockExplainHasCitationTo(
  markdown: string,
  path: string
): boolean {
  const want = normalizeIdeRelPath(path);
  return parseIdeCitations(markdown).some(
    (c) => normalizeIdeRelPath(c.path) === want
  );
}

export function appendExplainMessage(
  history: IdeExplainMessage[],
  msg: IdeExplainMessage,
  max = IDE_EXPLAIN_HISTORY_MAX
): IdeExplainMessage[] {
  return [...history, msg].slice(-max);
}

export function citationsFromMarkdown(content: string) {
  return parseIdeCitations(content).map((c) => ({
    path: c.path,
    line: c.line,
    endLine: c.endLine,
  }));
}

/** Encode a short SSE/text stream body (plain text chunks). */
export function encodeMockExplainStream(text: string): string {
  return text;
}
