/**
 * 行首轻量语法：列表 / 引用。
 *
 * 只做「回车续行」这一件事 —— 不解析、不渲染、不改文本，只回答
 * 「在这一行按回车，应该自动插入什么」。所以它既能给混合模式的 textarea 用，
 * 也能给 CM6 的 keymap 用，两边手感天然一致。
 *
 * 有意不做的事（见 STATUS-tier3 的限制）：
 *  - 不处理 `**` 行内标记展开、不处理表格对齐；
 *  - 不做整篇 contenteditable / 富文本编辑器那一套。
 * 这里只是把 Markdown 的**行首**当成可感知的结构，正文仍是纯文本。
 */

export type LinePrefixKind = "bullet" | "ordered" | "quote";

export type LinePrefix = {
  /** 行首缩进（原样保留，续行跟着缩进走）。 */
  indent: string;
  kind: LinePrefixKind;
  /** 列表标记本身：`-` / `*` / `+` / `1.`；引用为 `>`。 */
  marker: string;
  /** GFM 任务列表的框：`[ ] ` / `[x] `（含尾随空格）；没有则为空串。 */
  task: string;
  /** 标记之后的正文（已去掉标记与一个分隔空格）。 */
  rest: string;
};

/** `-` / `*` / `+` / `1.` / `1)`，最多 3 空格缩进（与 CommonMark 的列表一致）。 */
const LIST_RE = /^( {0,3})([-*+]|(\d{1,9})[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;
/** `>` 引用，最多 3 空格缩进。 */
const QUOTE_RE = /^( {0,3})(>)[ \t]?(.*)$/;

/** 解析一行的行首结构；不是列表/引用就返回 null。 */
export function matchLinePrefix(line: string): LinePrefix | null {
  const q = QUOTE_RE.exec(line);
  if (q) {
    return { indent: q[1]!, kind: "quote", marker: ">", task: "", rest: q[3]! };
  }
  const m = LIST_RE.exec(line);
  if (!m) return null;
  const marker = m[2]!;
  const ordered = /^\d/.test(marker);
  return {
    indent: m[1]!,
    kind: ordered ? "ordered" : "bullet",
    marker,
    task: m[5] ?? "",
    rest: m[6]!,
  };
}

/**
 * 下一项的标记：有序列表加一（保留 `1.` / `1)` 的分隔符），
 * 无序列表沿用原符号（`-` 还是 `-`，不会突然变 `*`）。
 */
function nextMarker(prefix: LinePrefix): string {
  if (prefix.kind !== "ordered") return prefix.marker;
  const n = Number.parseInt(prefix.marker, 10);
  const sep = prefix.marker.endsWith(")") ? ")" : ".";
  return `${n + 1}${sep}`;
}

export type LinePrefixContinuation =
  /** 插入这段文本（自带前导换行），光标会落在末尾。 */
  | { kind: "continue"; insert: string }
  /**
   * 空项再回车：把这一行清空（退出列表 / 引用），而不是再造一个空项。
   * 这是「删得掉」的关键 —— 否则空列表项只能自己删标记，很难退出。
   */
  | { kind: "clear" };

/**
 * 在这一行按回车应该发生什么。
 *
 * - 不是列表 / 引用 → null，交给编辑器默认行为（换行）。
 * - 空项（`- ` / `1. ` / `> `，没有任何正文）→ clear。
 * - 否则续上下一个标记；任务列表的框一律续成未勾选 `[ ] `。
 */
export function continueLinePrefix(line: string): LinePrefixContinuation | null {
  const prefix = matchLinePrefix(line);
  if (!prefix) return null;
  // 空项（含 `- [ ] ` 这种只有框、没正文）再回车 → 退出，跟 CM6 原来一致。
  if (!prefix.rest.trim()) return { kind: "clear" };

  if (prefix.kind === "quote") {
    return { kind: "continue", insert: `\n${prefix.indent}> ` };
  }
  const task = prefix.task ? "[ ] " : "";
  return {
    kind: "continue",
    insert: `\n${prefix.indent}${nextMarker(prefix)} ${task}`,
  };
}

/** 已经有缩进时按 Tab：缩进 2 空格（Markdown 里嵌套列表的常用步长）。 */
export const LIST_INDENT_STEP = "  ";

/**
 * 列表 / 引用行按 Tab 的结果；不是这类行返回 null（让编辑器保留默认 Tab 语义）。
 * 只加缩进，不重排内容 —— 用户还能自己按回来。
 */
export function indentLinePrefix(line: string): string | null {
  const prefix = matchLinePrefix(line);
  if (!prefix) return null;
  return `${prefix.indent}${LIST_INDENT_STEP}${line.slice(prefix.indent.length)}`;
}
