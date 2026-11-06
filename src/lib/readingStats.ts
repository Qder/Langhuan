import { parseFrontmatter } from "./tags";
import { stripHtml } from "./utils";

/**
 * 篇级统计：给「这篇有多长、要读多久」一个可复现的答案。
 *
 * 之所以不复用 `utils.countWords`：那个函数直接数原始 Markdown，`#`、`**`、
 * 链接地址、YAML 前言都会被算进去。这里先把「读的时候眼睛会扫过的字」挑出来，
 * 再做计数，所以同一篇文案在阅读页、阅读弹层、专注浮动条里报的是同一个数。
 */
export type ReadingStats = {
  /** 汉字/假名/谚文，逐字计。 */
  cjk: number;
  /** 拉丁字母与数字词，`state-of-the-art` 算一个词。 */
  latin: number;
  /** 「约 N 字」用的口径：中文按字 + 西文按词。 */
  chars: number;
  /** 被排除在正文之外的代码字符数（去空白），用于「代码未计入」的说明。 */
  codeChars: number;
  /** 预计阅读分钟，向上取整；空文为 0。 */
  minutes: number;
};

/** 中日韩表意文字 + 假名 + 谚文。刻意不包含全角标点与数字。 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
/** 词必须以字母/数字开头，所以 `---`、`|:--:|` 这类分隔行不会凭空多出词。 */
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;

/** 阅读速度：中文 400 字/分，西文 200 词/分。取整上取整，避免「读了 3 分钟显示 2 分钟」。 */
const CJK_PER_MINUTE = 400;
const LATIN_PER_MINUTE = 200;

/**
 * 按围栏切出正文与代码。
 *
 * 规则与混合模式的分块保持一致：闭合围栏必须同字符且长度不短于开启围栏，
 * 没闭合的围栏一直吃到文末（与 Markdown 渲染器一致），这样统计不会比眼睛
 * 实际看到的内容少。
 */
function splitFencedCode(source: string): { prose: string; code: string } {
  const prose: string[] = [];
  const code: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  /** 围栏内部的行走先攒着，闭合时整段归代码，未闭合时也同样归代码。 */
  let buffer: string[] = [];

  for (const line of source.split("\n")) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        code.push(...buffer);
        buffer = [];
        fence = null;
      } else {
        buffer.push(line);
      }
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    // 反引号围栏的信息串里不能再出现反引号（CommonMark），否则是行内代码。
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { ch: open[1]![0]!, len: open[1]!.length };
      continue;
    }
    prose.push(line);
  }
  code.push(...buffer);
  return { prose: prose.join("\n"), code: code.join("\n") };
}

/**
 * 去掉「不该算进阅读量的标记」。
 *
 * 强调符、标题井号、表格竖线这些本来就不匹配中英文的正则，所以不专门处理；
 * 真正会误导计数的是链接/图片地址和行内 HTML 属性里的英文词。
 */
function stripMarkup(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ") // 图片：留 alt，扔地址
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, " $2 ") // [[目标|别名]]
    .replace(/\[\[([^\]]+)\]\]/g, " $1 ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ") // 链接：留文字，扔地址
    .replace(/\[\^[^\]]*\]/g, " ") // 脚注引用
    .replace(/<[^>]+>/g, " ") // 行内 / 块级 HTML 标签
    .replace(/`([^`]+)`/g, " $1 ") // 行内代码算正文：它在句子里是要读的
    .replace(/https?:\/\/\S+/g, " "); // 裸链接
}

function countIn(text: string): { cjk: number; latin: number } {
  return {
    cjk: (text.match(CJK_RE) || []).length,
    latin: (text.match(LATIN_WORD_RE) || []).length,
  };
}

function finish(cjk: number, latin: number, codeChars: number): ReadingStats {
  const chars = cjk + latin;
  const minutes =
    chars === 0
      ? 0
      : Math.max(1, Math.ceil(cjk / CJK_PER_MINUTE + latin / LATIN_PER_MINUTE));
  return { cjk, latin, chars, codeChars, minutes };
}

/** Markdown 篇级统计：去 YAML 前言，围栏代码块默认不计。 */
export function readingStatsOfMarkdown(content: string): ReadingStats {
  const { body } = parseFrontmatter(content);
  const { prose, code } = splitFencedCode(body);
  const { cjk, latin } = countIn(stripMarkup(prose));
  return finish(cjk, latin, code.replace(/\s+/g, "").length);
}

/** HTML 文档沿用同一把尺子，只是先剥标签。 */
export function readingStatsOfHtml(html: string): ReadingStats {
  const { cjk, latin } = countIn(stripMarkup(stripHtml(html)));
  return finish(cjk, latin, 0);
}

export function readingStatsOf(content: string, type: "md" | "html" = "md"): ReadingStats {
  return type === "html" ? readingStatsOfHtml(content) : readingStatsOfMarkdown(content);
}

/** 3456 → 3,456。手写而不用 toLocaleString，保证测试与不同运行时的输出一致。 */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function readingTimeLabel(stats: Pick<ReadingStats, "minutes">): string {
  return stats.minutes > 0 ? `约 ${stats.minutes} 分钟` : "0 分钟";
}

/** 阅读弹层里的中英分项：只报非零项，中文文档不会凭空出现「西文 0 词」。 */
export function readingBreakdown(stats: ReadingStats): string {
  const parts: string[] = [];
  if (stats.cjk > 0) parts.push(`中文 ${formatCount(stats.cjk)}`);
  if (stats.latin > 0) parts.push(`西文 ${formatCount(stats.latin)} 词`);
  if (parts.length === 0) return stats.codeChars > 0 ? "只有代码，没有正文" : "空文档";
  return parts.join(" · ");
}

/** 「代码未计入」出现在有代码的文档上，没有代码就不提这茬。 */
export function codeExcludedNote(stats: ReadingStats): string | null {
  if (stats.codeChars <= 0) return null;
  return `代码约 ${formatCount(stats.codeChars)} 字符未计入`;
}

/** 一行式摘要，给浮动条 / 状态栏 / aria-label 用。 */
export function readingStatsSummary(stats: ReadingStats): string {
  if (stats.chars === 0 && stats.codeChars === 0) return "空文档";
  return `${formatCount(stats.chars)} 字 · ${readingTimeLabel(stats)}`;
}

/** 悬浮提示：摘要 + 中英分项 + 代码说明，一行解释清楚这个数是怎么来的。 */
export function readingStatsTitle(stats: ReadingStats): string {
  const parts = [readingStatsSummary(stats), readingBreakdown(stats)];
  const note = codeExcludedNote(stats);
  if (note) parts.push(note);
  return parts.join("｜");
}
