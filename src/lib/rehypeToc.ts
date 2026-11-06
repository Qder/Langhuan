/**
 * rehype-toc: 把 `<!-- toc -->` 标记换成文内目录。
 *
 *   <p>…</p>
 *   <!-- toc -->
 *   <h2 id="小节">小节</h2>
 *
 * becomes
 *
 *   <p>…</p>
 *   <div class="lh-toc" data-toc role="navigation">…</div>
 *   <h2 id="小节">小节</h2>
 *
 * 三个刻意的决定：
 *
 * 1. **必须在 rehype-sanitize 之前跑**。sanitize 会把注释节点整个丢掉（不是转义，
 *    是删除），之后再想找标记就已经没了。预览链里它排在 sanitize 前面；
 *    导出没有 sanitize，排在哪都行，但为了两条链顺序一致，也放在同样位置。
 *
 * 2. **目录项从 AST 里取，不从源码正则取**。此时 rehype-slug 已经给标题写好 id，
 *    直接读这些 id 就能保证「点了真的能跳到那一行」——比另算一遍 slug 更不会分叉。
 *
 * 3. **层级用嵌套 `<ul>` 表达，不靠每项一个 class**。sanitize 只会给少数几个标签
 *    放行 `className`，`ul`/`li` 不在其中；而嵌套结构本身就带着层级信息，
 *    缩进交给 CSS 的 `ul ul` 规则，两条渲染链（预览 / 导出）天然一致。
 */

import type { Element, ElementContent, Root, RootContent } from "hast";
import { MAX_OUTLINE_DEPTH } from "./outline";

/** 与 `lib/tocMarker.ts` 的 TOC_MARKER 对齐；注释内容两侧的空格来自 HTML 解析。 */
const TOC_COMMENT_RE = /^\s*toc\s*$/i;

type HeadingEntry = { id: string; text: string; level: number };

function isTocComment(node: RootContent): boolean {
  return node.type === "comment" && TOC_COMMENT_RE.test(node.value);
}

function headingLevel(node: RootContent): number | null {
  if (node.type !== "element") return null;
  const m = /^h([1-6])$/.exec(node.tagName);
  if (!m) return null;
  const level = Number(m[1]);
  return level <= MAX_OUTLINE_DEPTH ? level : null;
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/**
 * 收集全文 h1–h4。
 * 没有 id 的标题跳过——它在预览里没有锚点，列进目录只会点不动。
 */
function collectHeadings(tree: Root): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      const level = headingLevel(child as RootContent);
      if (level != null) {
        const el = child as Element;
        const id = typeof el.properties?.id === "string" ? el.properties.id : "";
        const text = textOf(el).replace(/\s+/g, " ").trim();
        if (id && text) out.push({ id, text, level });
        continue;
      }
      if (child.type === "element") walk(child);
    }
  };
  walk(tree);
  return out;
}

function anchor(entry: HeadingEntry): Element {
  return {
    type: "element",
    tagName: "a",
    properties: { href: `#${entry.id}`, "data-toc-target": entry.id },
    children: [{ type: "text", value: entry.text }],
  };
}

/**
 * 目录层级树：把扁平标题列表折成嵌套结构。
 *
 * `base` 是最小标题层级：文档从 h2 起时，h1 那层不该空着，否则整块目录右移一大截。
 * 层级「跳级」（h2 直接到 h4）时按实际深度插进去，而不是硬补一层空 `<ul>` 填充——
 * 空列表会让缩进看着像多了两格，却没有任何内容。
 *
 * 关键在「下一层的子列表要挂在**上一个条目**下面」：这样 h2 在前、h3 在后时，
 * h3 成为 h2 的子项；而下一条 h2 又会回到同一层做兄弟，不会被吞进前一条里面。
 *
 * 返回纯数据，HTML 版（rehype）与 React 版（混合模式）都从这里长出来，
 * 两条路径的缩进不会各写一遍然后悄悄分叉。
 */
export type TocNode = { entry: HeadingEntry; children: TocNode[] };

export function buildTocTree(entries: HeadingEntry[], base?: number): TocNode[] {
  const b = base ?? (entries.length ? Math.min(...entries.map((e) => e.level)) : 1);
  const roots: TocNode[] = [];
  /** stack[d] 收集「深度 d 的条目」。 */
  const stack: TocNode[][] = [roots];

  for (const entry of entries) {
    const depth = Math.max(0, Math.min(stack.length, entry.level - b));
    while (stack.length <= depth) {
      const parentList = stack[stack.length - 1]!;
      const last = parentList[parentList.length - 1];
      // 没有可挂靠的上一条目（文档一开始就是深标题）就退回根层，不造孤儿子层。
      if (!last) break;
      const children: TocNode[] = [];
      last.children = children;
      stack.push(children);
    }
    const target = stack[Math.min(depth, stack.length - 1)]!;
    target.push({ entry, children: [] });
    stack.length = Math.min(depth, stack.length - 1) + 1;
  }
  return roots;
}

function renderTocNodes(nodes: TocNode[]): Element {
  return {
    type: "element",
    tagName: "ul",
    properties: {},
    children: nodes.map((node) => {
      const li: Element = {
        type: "element",
        tagName: "li",
        properties: {},
        children: [anchor(node.entry)],
      };
      if (node.children.length) li.children.push(renderTocNodes(node.children));
      return li;
    }),
  };
}

/**
 * 空目录也给出可见提示，而不是留一片空白。
 * 「插了目录但看不见」会让人以为功能坏了。
 */
function emptyToc(): Element {
  return {
    type: "element",
    tagName: "p",
    properties: { className: ["lh-toc-empty"] },
    children: [{ type: "text", value: "（目录为空：加上标题后这里会自动列出）" }],
  };
}

export type RehypeTocOptions = {
  /** 目录块的标题文字；传空串则不渲染标题行。 */
  title?: string;
};

export function rehypeToc(options: RehypeTocOptions = {}) {
  const title = options.title ?? "目录";
  return (tree: Root) => {
    const jobs: { parent: Element | Root; index: number }[] = [];
    const scan = (node: Root | Element) => {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        if (isTocComment(child)) {
          jobs.push({ parent: node, index: i });
          continue;
        }
        if (child.type === "element") scan(child);
      }
    };
    scan(tree);
    if (!jobs.length) return;

    const headings = collectHeadings(tree);
    const base = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

    // 倒序替换，前面的下标不会被后面的删除带偏。
    for (let i = jobs.length - 1; i >= 0; i--) {
      const { parent, index } = jobs[i]!;
      const children: ElementContent[] = [];
      if (title) {
        children.push({
          type: "element",
          tagName: "p",
          properties: { className: ["lh-toc-title"] },
          children: [{ type: "text", value: title }],
        });
      }
      children.push(headings.length ? renderTocNodes(buildTocTree(headings, base)) : emptyToc());

      // 用 `div` 而不是 `nav`：`nav` 不在 sanitize 白名单里，而 sanitize 对不认识的
      // 元素是**连子节点一起删**（不是只脱标签），结果会是「预览里目录整块消失」。
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["lh-toc"],
          "data-toc": "",
          role: "navigation",
          "aria-label": title || "目录",
        },
        children,
      };
    }
  };
}

/** 供测试与调用方判断某段 HTML 是否已含目录块。 */
export function hasRenderedToc(html: string): boolean {
  return /class="[^"]*\blh-toc\b[^"]*"/.test(html);
}
