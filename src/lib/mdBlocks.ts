/**
 * Split Markdown into editable blocks for Typora-like mixed mode.
 *
 * 规则（MVP 加强，2026-11）：
 *  1. 围栏代码块整体成块 —— ``` 与 ~~~ 都认，闭合围栏必须同字符且不短于开头，
 *     所以 ```` 里出现的 ``` 只是内容。块内空行不算分隔。
 *  2. `$$` 公式块整体成块；表格（连续 `|` 开头的行）也整体成块，且不与相邻
 *     正文粘连（即使前后没有空行）。块内空行不算分隔。
 *  3. 标题永远独占一块：前一行的正文在标题处切开，标题后的正文也另起一块。
 *
 * 除此之外仍是「空行分块」：松散列表（`- a` / 空行 / `- b`）照旧拆开。
 * 块文本尾部空白会在回写时被 `joinMarkdownBlocks` 规整成单个空行分隔。
 */

export type MdBlock = {
  index: number;
  start: number;
  end: number;
  text: string;
};

/** ``` / ~~~，最多 3 空格缩进（CommonMark）。 */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}#{1,6}[ \t]/;
const MATH_RE = /^ {0,3}\$\$/;
const TABLE_RE = /^ {0,3}\|/;
const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** 行尾下标（不含换行符）。 */
function eolOf(source: string, from: number): number {
  const i = source.indexOf("\n", from);
  return i < 0 ? source.length : i;
}

/** 下一行起点；到文件末尾就返回 length。 */
function nextLine(source: string, eol: number): number {
  return eol < source.length ? eol + 1 : eol;
}

/**
 * 围栏代码块的结束位置：找到同字符、长度不短于开头的闭合围栏。
 * 没闭合就到文件末尾（编辑器里正在写的代码块不该被拆碎）。
 */
function endOfFence(
  source: string,
  afterOpeningLine: number,
  char: string,
  len: number
): number {
  let i = afterOpeningLine;
  while (i < source.length) {
    const eol = eolOf(source, i);
    const m = CLOSE_FENCE_RE.exec(source.slice(i, eol));
    if (m && m[1]![0] === char && m[1]!.length >= len) return nextLine(source, eol);
    i = nextLine(source, eol);
  }
  return source.length;
}

/** `$$` 公式块：单行 `$$ … $$` 自成一块，否则扫到下一个以 `$$` 收尾的行。 */
function endOfMath(source: string, start: number): number {
  const firstEol = eolOf(source, start);
  const firstLine = source.slice(start, firstEol).trim();
  // `$$a+b$$`：同一行既有开头又有收尾
  if (firstLine.length > 4 && firstLine.endsWith("$$")) {
    return nextLine(source, firstEol);
  }
  let i = nextLine(source, firstEol);
  while (i < source.length) {
    const eol = eolOf(source, i);
    const line = source.slice(i, eol).trim();
    if (line.endsWith("$$")) return nextLine(source, eol);
    i = nextLine(source, eol);
  }
  return source.length;
}

/** 表格：连续以 `|` 开头的行。空行结束。 */
function endOfTable(source: string, start: number): number {
  let i = start;
  let end = start;
  while (i < source.length) {
    const eol = eolOf(source, i);
    const line = source.slice(i, eol);
    if (line.trim() && !TABLE_RE.test(line)) break;
    if (!line.trim()) break;
    end = nextLine(source, eol);
    i = end;
  }
  return end > start ? end : nextLine(source, eolOf(source, start));
}

/** 这一行是不是「必须自己开块」的特殊结构。 */
function startsSpecial(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    MATH_RE.test(line) ||
    TABLE_RE.test(line)
  );
}

export function splitMarkdownBlocks(source: string): MdBlock[] {
  if (!source) return [{ index: 0, start: 0, end: 0, text: "" }];
  const blocks: MdBlock[] = [];
  let i = 0;
  const n = source.length;
  let index = 0;

  while (i < n) {
    // 跳过块之间的空行
    if (source[i] === "\n") {
      i += 1;
      continue;
    }
    const start = i;
    const eol = eolOf(source, start);
    const firstLine = source.slice(start, eol);

    const fence = FENCE_RE.exec(firstLine);
    if (fence) {
      // 规则 1：围栏代码整体成块（闭合围栏同字符且不短于开头）
      i = endOfFence(source, nextLine(source, eol), fence[1]![0]!, fence[1]!.length);
    } else if (MATH_RE.test(firstLine)) {
      // 规则 2a：`$$` 公式块整体成块
      i = endOfMath(source, start);
    } else if (TABLE_RE.test(firstLine)) {
      // 规则 2b：表格整体成块
      i = endOfTable(source, start);
    } else if (HEADING_RE.test(firstLine)) {
      // 规则 3：标题独占一块
      i = nextLine(source, eol);
    } else {
      // 普通段落：到空行，或撞上必须自己开块的结构为止
      i = nextLine(source, eol);
      while (i < n) {
        const lineEol = eolOf(source, i);
        const line = source.slice(i, lineEol);
        if (!line.trim()) break;
        if (startsSpecial(line)) break;
        i = nextLine(source, lineEol);
      }
    }

    const end = i;
    const text = source.slice(start, end).replace(/\n$/, "");
    blocks.push({ index, start, end: start + text.length, text });
    index += 1;
    // 消费块后的一个换行（空行会在下一轮被跳过）
    if (i < n && source[i] === "\n") i += 1;
  }

  if (!blocks.length) {
    return [{ index: 0, start: 0, end: source.length, text: source }];
  }
  return blocks;
}

/** Rebuild full source from block texts (join with blank line). */
export function joinMarkdownBlocks(texts: string[]): string {
  return texts.map((t) => t.replace(/\s+$/, "")).join("\n\n");
}
