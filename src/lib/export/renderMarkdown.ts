/**
 * 导出用的 Markdown → HTML 渲染。
 *
 * 预览里的三件事，导出时原来是缺的：
 *  - callout（`> [!note]`）→ 现在直接吐字面量 `[!note] 标题`；
 *  - 双链（`[[目标|别名]]`）→ 现在吐字面量方括号；
 *  - 相对图片 → 现在保留 `assets/x.png`，但导出物里没有这个文件，离线必裂。
 *
 * 这里把预览的 rehype 插件链搬过来（callout 复用同一个 `rehypeCallout`），
 * 再补两道只有导出才需要的改写：媒体与链接。两者都由调用方注入，
 * 因为「内联成 data URL」和「落成 zip 里的相对路径」是两种产物。
 */
import type { Element, ElementContent, Root, Text } from "hast";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { parseFrontmatter } from "../tags";
import type { Document } from "../types";
import { basename, titleOf } from "../utils";
import {
  isAbsoluteUrl,
  libraryPathCandidates,
  mediaSrcFromDocContent,
  resolveAgainstDocPath,
} from "../resolveLibraryPath";
import { parseWikiInner } from "../wikilink";
import { rehypeCallout } from "../rehypeCallout";
import { escapeHtml } from "./escape";

/** 读一个库内二进制文件，返回 base64（无 data: 前缀）。 */
export type ExportAssetReader = (path: string) => Promise<{ mime: string; base64: string } | null>;

export type RenderMarkdownOptions = {
  content: string;
  /** 当前文档的库内路径，用来解析相对链接 / 图片。 */
  docPath: string;
  /** 全库文档，用来把 `[[双链]]` 指到真正的目标。 */
  docs: Document[];
  /**
   * 目标文档在导出物里的链接。返回 null 表示该目标不在导出范围内
   * （单篇独立 HTML 就是这种情况）——那就渲染成不可点的胶囊，而不是死链。
   */
  hrefForDoc?: (doc: Document) => string | null;
  /**
   * 把库内媒体路径变成可用的 `src`（inline 是 data URL，zip 是相对路径）。
   * 返回 null 表示取不到文件，渲染成占位说明。
   */
  resolveAsset?: (path: string) => Promise<string | null>;
};

const WIKI_RE = /(!)?\[\[([^\]\]]+?)\]\]/g;

/** 只有文本节点里的双链需要改写；代码块里的原样保留。 */
const SKIP_INLINE_TAGS = new Set(["code", "pre", "script", "style", "kbd", "samp"]);

function text(value: string): Text {
  return { type: "text", value };
}

function el(
  tagName: string,
  properties: Record<string, string | number | boolean | (string | number)[] | null | undefined>,
  children: ElementContent[]
): Element {
  return { type: "element", tagName, properties, children };
}

function findDoc(docs: Document[], path: string): Document | undefined {
  for (const candidate of libraryPathCandidates(path)) {
    const exact = docs.find((d) => d.path === candidate);
    if (exact) return exact;
    const lower = candidate.toLowerCase();
    const byLower = docs.find((d) => d.path.toLowerCase() === lower);
    if (byLower) return byLower;
  }
  return undefined;
}

/** 没写扩展名的 `[[欢迎]]` 也要能找到 `欢迎.md`。 */
function findDocByWikiTarget(docs: Document[], target: string): Document | undefined {
  const n = target.trim();
  if (!n) return undefined;
  return (
    docs.find((d) => titleOf(d.path) === n) ||
    docs.find((d) => basename(d.path) === n) ||
    docs.find((d) => d.path === n) ||
    docs.find((d) => d.path.replace(/\.(md|html)$/i, "") === n)
  );
}

/**
 * `[[目标#标题|别名]]` → 胶囊。
 * 目标在导出范围内且调用方给了 href 时可点；否则是不可点的 span（带原因 title）。
 */
function wikilinkNode(raw: string, inner: string, opts: RenderMarkdownOptions): ElementContent[] {
  const parsed = parseWikiInner(inner);
  const label = parsed.alias || parsed.target || parsed.heading || inner;
  const out: ElementContent[] = [];

  if (raw.startsWith("!")) {
    // `![[x]]` 是嵌入：导出里不做转写，保留原文并标出来。
    return [
      el("span", { className: ["export-wiki", "export-wiki-embed"], title: "嵌入未展开：" + inner }, [
        text(raw),
      ]),
    ];
  }

  const doc = parsed.target ? findDocByWikiTarget(opts.docs, parsed.target) : undefined;
  const href = doc && opts.hrefForDoc ? opts.hrefForDoc(doc) : null;
  if (doc && href) {
    out.push(
      el(
        "a",
        {
          className: ["export-wiki", "export-wiki-link"],
          href: parsed.heading ? `${href}#${anchorId(parsed.heading)}` : href,
        },
        [text(label)]
      )
    );
  } else {
    out.push(
      el(
        "span",
        {
          className: ["export-wiki", doc ? "export-wiki-outside" : "export-wiki-missing"],
          title: doc ? "目标不在本次导出范围内" : "库内没有这篇笔记",
          "data-wiki-target": parsed.target || inner,
        },
        [text(label)]
      )
    );
  }
  return out;
}

/** 与预览的 rehypeSlug 保持同一套 id 规则（小写、空白转连字符、去标点）。 */
export function anchorId(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "");
}

function rehypeWikilinks(opts: RenderMarkdownOptions) {
  return (tree: Root) => {
    const walk = (node: Element | Root) => {
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i]!;
        if (child.type === "element") {
          if (SKIP_INLINE_TAGS.has(child.tagName)) continue;
          walk(child);
          continue;
        }
        if (child.type !== "text" || !child.value.includes("[[")) continue;

        const pieces: ElementContent[] = [];
        const re = new RegExp(WIKI_RE.source, "g");
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(child.value))) {
          if (m.index > last) pieces.push(text(child.value.slice(last, m.index)));
          pieces.push(...wikilinkNode(m[0], m[2]!, opts));
          last = m.index + m[0].length;
        }
        if (!pieces.length) continue;
        if (last < child.value.length) pieces.push(text(child.value.slice(last)));
        kids.splice(i, 1, ...pieces);
        i += pieces.length - 1;
      }
    };
    walk(tree);
  };
}

function rehypeExportMedia(opts: RenderMarkdownOptions) {
  return async (tree: Root) => {
    const jobs: Element[] = [];
    const walk = (node: Element | Root) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "img") jobs.push(child);
        else walk(child);
      }
    };
    walk(tree);

    for (const img of jobs) {
      const src = typeof img.properties?.src === "string" ? img.properties.src : "";
      if (!src || isAbsoluteUrl(src)) continue;

      const resolvedPath = resolveAgainstDocPath(opts.docPath, src);
      const alt = typeof img.properties?.alt === "string" ? img.properties.alt : "";

      // SVG 写在库内文档里：预览是把文本转成 data URL 的，导出照做。
      const svgDoc = findDoc(opts.docs, resolvedPath);
      const inlineFromDoc = svgDoc ? mediaSrcFromDocContent(svgDoc.content) : null;
      const next = inlineFromDoc || (opts.resolveAsset ? await opts.resolveAsset(resolvedPath) : null);

      if (next) {
        img.properties = { ...img.properties, src: next };
        continue;
      }

      // 取不到就明说，别留一个默默碎裂的 img。
      const placeholder = el(
        "span",
        {
          className: ["export-missing-media"],
          role: "img",
          "data-missing-src": resolvedPath,
        },
        [text(`图片未找到：${resolvedPath}`), alt ? text(`（${alt}）`) : text("")]
      );
      img.type = "element";
      Object.assign(img, placeholder);
    }
  };
}

function rehypeExportLinks(opts: RenderMarkdownOptions) {
  return (tree: Root) => {
    const walk = (node: Element | Root) => {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        if (child.type !== "element") continue;
        if (child.tagName === "a") {
          // 双链那道已经换成导出物路径了，别再按库内路径解析一遍。
          const classes = (child.properties?.className as string[] | undefined) ?? [];
          if (classes.includes("export-wiki-link")) continue;
          const href = typeof child.properties?.href === "string" ? child.properties.href : "";
          if (href && !isAbsoluteUrl(href)) {
            const target = findDoc(opts.docs, resolveAgainstDocPath(opts.docPath, href));
            const next = target && opts.hrefForDoc ? opts.hrefForDoc(target) : null;
            if (next) {
              child.properties = { ...child.properties, href: next };
            } else {
              // 目标不在导出范围：留文字，去掉 href，别让读者点进 404。
              child.properties = {
                ...child.properties,
                className: [...classes, "export-link-plain"],
                title: target ? "目标不在本次导出范围内" : "目标不在库内",
              };
              delete child.properties.href;
              child.tagName = "span";
            }
          }
          continue;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

/** 导出用标题：frontmatter.title → 首个 H1 → 文件名。 */
export function exportTitleOf(content: string, docPath: string): { title: string; body: string } {
  const { data, body } = parseFrontmatter(content);
  const fromMeta = typeof data.title === "string" ? data.title.trim() : "";
  const fromH1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  return { title: fromMeta || fromH1 || titleOf(docPath), body };
}

/**
 * 渲染一篇 Markdown 的正文 HTML。
 * 与预览用同一批插件（GFM / callout / 代码高亮），差别只在媒体与链接的落法。
 */
export async function renderMarkdownForExport(
  opts: RenderMarkdownOptions
): Promise<{ title: string; bodyHtml: string }> {
  const { title, body } = exportTitleOf(opts.content, opts.docPath);

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // 预览也是先 slug（锚点），再 callout：双链带 #标题 时要能落到同一个 id。
    .use(rehypeSlug)
    // 顺序跟预览一致：callout 在 raw 之后，卡片能接住手写的 blockquote。
    .use(rehypeCallout)
    .use(rehypeWikilinks, opts)
    .use(rehypeExportMedia, opts)
    .use(rehypeExportLinks, opts)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(body);

  return { title, bodyHtml: String(file) };
}

/** 检测是否用到了语法高亮，方便调用方决定要不要带 hljs 样式（导出里始终带）。 */
export function hasHighlightedCode(bodyHtml: string): boolean {
  return bodyHtml.includes('class="hljs');
}

export { escapeHtml };
