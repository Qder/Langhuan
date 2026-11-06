import GithubSlugger from "github-slugger";
import { parseFrontmatter } from "./tags";
import { MAX_OUTLINE_DEPTH, outlineHeadingText } from "./outline";

/**
 * 文内目录（TOC）的唯一约定标记。
 *
 * 为什么钉死 HTML 注释而不是 `[TOC]`：
 *  - `<!-- toc -->` 在任何 Markdown 渲染器里都不可见，被误删/被别的工具看到也不会变成
 *    正文里一行莫名其妙的 `[TOC]`；
 *  - 它本身不产生 DOM，所以预览里「标记 → 目录」是一次纯替换，不会留下空壳；
 *  - `[TOC]` 在 CommonMark 里是普通段落，还要额外解释「为什么这行字不见了」。
 *
 * 只认这一种写法，且必须独占一行（允许前后空白）。写成 `<!-- toc --> 别的字` 不算，
 * 免得用户把注释当行内备注用的时候被意外展开成一大块目录。
 */
export const TOC_MARKER = "<!-- toc -->";

/** 一行里只有标记（允许缩进与行尾空白）时才算目录位。 */
const TOC_MARKER_LINE_RE = /^[ \t]*<!--\s*toc\s*-->[ \t]*$/i;

/** 这一行是不是文内 TOC 标记。 */
export function isTocMarkerLine(line: string): boolean {
  return TOC_MARKER_LINE_RE.test(line);
}

/** 文本里是否有至少一处 TOC 标记。 */
export function hasTocMarker(md: string): boolean {
  return md.split(/\r?\n/).some(isTocMarkerLine);
}

export type TocEntry = {
  /** 与 rehype-slug 一致的锚点 id。 */
  id: string;
  text: string;
  level: number;
};

/**
 * 按正文顺序取 h1–h4 作为目录项。
 *
 * 与 `extractOutline` 的差别：这里**跳过围栏代码块与 `$$` 公式块**。
 * 侧栏大纲为了跟「点了能不能跳」严格对齐，用的是逐行正则；但文内目录是读者直接看到的
 * 一块内容，代码里以 `#` 开头的注释行被列进去会显得很傻。
 *
 * 代价是：如果代码块里恰好有一行 `# 标题`，两处的编号会从这里开始分叉。
 * 这可以接受——文内目录是「给人看的列表」，侧栏是「给眼睛找位置的索引」。
 */
export function collectTocEntries(md: string): TocEntry[] {
  const { body } = parseFrontmatter(md);
  const slugger = new GithubSlugger();
  const out: TocEntry[] = [];
  const heading = new RegExp(`^ {0,3}(#{1,${MAX_OUTLINE_DEPTH}})[ \\t]+(.+?)[ \\t]*#*[ \\t]*$`);

  let fence: { ch: string; len: number } | null = null;
  let inMath = false;

  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        fence = null;
      }
      continue;
    }
    if (inMath) {
      if (/^ {0,3}\$\$[ \t]*$/.test(line) || /^ {0,3}\$\$.*\$\$[ \t]*$/.test(line)) {
        inMath = false;
      }
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    // 反引号围栏的信息串里不能再出现反引号（CommonMark），否则是行内代码。
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { ch: open[1]![0]!, len: open[1]!.length };
      continue;
    }
    if (/^ {0,3}\$\$/.test(line)) {
      if (!/^ {0,3}\$\$.*\$\$[ \t]*$/.test(line)) inMath = true;
      continue;
    }

    const m = line.match(heading);
    if (!m) continue;
    const text = outlineHeadingText(m[2]!);
    if (!text) continue;
    out.push({ id: slugger.slug(text), text, level: m[1]!.length });
  }
  return out;
}

/** 把目录项压成最小层级，避免文档从 h1 起时整块目录右移一大截。 */
export function tocRenderBaseLevel(entries: TocEntry[]): number {
  let min = MAX_OUTLINE_DEPTH;
  for (const e of entries) if (e.level < min) min = e.level;
  return min;
}

export type TocInsertPlan =
  | { kind: "insert"; reason: "no-marker" }
  | { kind: "exists"; reason: "already-inserted" };

/**
 * 插入计划：已有标记就明说「已经插过了」，不要再塞第二个。
 * 两个标记会让读者看到两块一模一样的目录，比不插更糟。
 */
export function planTocInsert(md: string): TocInsertPlan {
  return hasTocMarker(md) ? { kind: "exists", reason: "already-inserted" } : { kind: "insert", reason: "no-marker" };
}

/**
 * 选插入位置：正文第一个标题之前。
 *
 * 放在文首（frontmatter 之后、任何标题之前）最符合「先看目录再读」的预期；
 * 也保证目录里的第一项不会出现在目录自己上方——目录不列目录。
 */
export function tocInsertOffset(md: string): number {
  const { body } = parseFrontmatter(md);
  const fmLen = md.length - body.length;
  const lines = body.split(/\r?\n/);
  let offset = fmLen;
  for (const line of lines) {
    const next = offset + line.length + 1;
    if (/^ {0,3}#{1,6}[ \t]/.test(line)) {
      // 插在这个标题前面，并保留一行空行分隔。
      return Math.max(fmLen, offset);
    }
    offset = next;
  }
  return fmLen;
}

/** 插到 `tocInsertOffset` 处；返回新文本与标记自身的偏移（供编辑器定位）。 */
export function insertTocMarker(
  md: string,
  opts?: { marker?: string }
): { text: string; markerStart: number } {
  const marker = opts?.marker ?? TOC_MARKER;
  const at = tocInsertOffset(md);
  const head = md.slice(0, at);
  const tail = md.slice(at);
  // 前一段已经有内容就补空行，避免标记黏在上一段末尾。
  const lead = head.length && !/\n\n$/.test(head) ? (head.endsWith("\n") ? "\n" : "\n\n") : "";
  const body = `${head}${lead}${marker}\n\n${tail.replace(/^\n{1,2}/, "")}`;
  return { text: body, markerStart: head.length + lead.length };
}
