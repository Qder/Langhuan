/**
 * Parse `/` slash command prefix at the start of the current line (or after whitespace).
 */

export type SlashCommandId =
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "task"
  | "quote"
  | "hr"
  | "code"
  | "wikilink"
  | "embed"
  | "table"
  | "callout-tip"
  | "math";

export type SlashCommand = {
  id: SlashCommandId;
  label: string;
  hint: string;
  /** Keywords for filtering (Chinese + ascii). */
  keywords: string[];
  /**
   * Text to insert. `{cursor}` marks caret after insert (removed from text).
   * Replaces the `/query` trigger span.
   */
  insert: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "h1",
    label: "一级标题",
    hint: "#",
    keywords: ["h1", "heading", "标题", "一级"],
    insert: "# {cursor}",
  },
  {
    id: "h2",
    label: "二级标题",
    hint: "##",
    keywords: ["h2", "heading", "标题", "二级"],
    insert: "## {cursor}",
  },
  {
    id: "h3",
    label: "三级标题",
    hint: "###",
    keywords: ["h3", "heading", "标题", "三级"],
    insert: "### {cursor}",
  },
  {
    id: "ul",
    label: "无序列表",
    hint: "-",
    keywords: ["ul", "list", "列表", "bullet"],
    insert: "- {cursor}",
  },
  {
    id: "ol",
    label: "有序列表",
    hint: "1.",
    keywords: ["ol", "list", "列表", "numbered"],
    insert: "1. {cursor}",
  },
  {
    id: "task",
    label: "待办",
    hint: "- [ ]",
    keywords: ["todo", "task", "待办", "checkbox"],
    insert: "- [ ] {cursor}",
  },
  {
    id: "quote",
    label: "引用",
    hint: ">",
    keywords: ["quote", "blockquote", "引用"],
    insert: "> {cursor}",
  },
  {
    id: "hr",
    label: "分隔线",
    hint: "---",
    keywords: ["hr", "divider", "分隔"],
    insert: "\n---\n{cursor}",
  },
  {
    id: "code",
    label: "代码块",
    hint: "```",
    keywords: ["code", "fence", "代码"],
    insert: "```\n{cursor}\n```",
  },
  {
    id: "wikilink",
    label: "双链",
    hint: "[[ ]]",
    keywords: ["wiki", "link", "双链", "wikilink"],
    insert: "[[{cursor}]]",
  },
  {
    id: "embed",
    label: "嵌入",
    hint: "![[ ]]",
    keywords: ["embed", "嵌入", "transclude"],
    insert: "![[{cursor}]]",
  },
  {
    id: "table",
    label: "表格",
    hint: "| |",
    keywords: ["table", "表格"],
    insert: "| 列1 | 列2 |\n| --- | --- |\n| {cursor} |  |\n",
  },
  {
    id: "callout-tip",
    label: "提示框",
    hint: "[!tip]",
    keywords: ["callout", "tip", "提示"],
    insert: "> [!tip]\n> {cursor}\n",
  },
  {
    id: "math",
    label: "公式块",
    hint: "$$",
    keywords: ["math", "katex", "公式", "latex"],
    insert: "$$\n{cursor}\n$$\n",
  },
];

export type SlashMatch = {
  /** Absolute offset of `/` in the document. */
  start: number;
  /** Absolute offset of caret (end of query). */
  end: number;
  query: string;
  items: SlashCommand[];
};

/**
 * Detect `/query` immediately before `caret` when it starts a line
 * (or is only preceded by whitespace on that line).
 */
export function matchSlashCommand(text: string, caret: number): SlashMatch | null {
  const o = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, o);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = before.slice(lineStart);
  const m = lineBefore.match(/^(\s*)\/([^\n]*)$/);
  if (!m) return null;
  const ws = m[1].length;
  const query = m[2];
  // Don't treat URLs or paths: require that `/` is the first non-ws on the line
  // (already enforced by regex). Also skip if query contains spaces beyond first token — still ok for filter.
  const start = lineStart + ws;
  const end = o;
  const items = filterSlashCommands(query);
  if (!items.length && query.length > 12) return null;
  return { start, end, query, items };
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => {
    const hay = [c.id, c.label, c.hint, ...c.keywords].join(" ").toLowerCase();
    return hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
  });
}

/** Apply insert template; returns new text + caret after insert. */
export function applySlashInsert(
  text: string,
  match: SlashMatch,
  cmd: SlashCommand
): { text: string; caret: number } {
  const raw = cmd.insert;
  const cursorIdx = raw.indexOf("{cursor}");
  const body = raw.replace("{cursor}", "");
  const next = text.slice(0, match.start) + body + text.slice(match.end);
  const caret =
    match.start + (cursorIdx >= 0 ? cursorIdx : body.length);
  return { text: next, caret };
}
