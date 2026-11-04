import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { mdSanitizeSchema } from "./mdSanitizeSchema";
import { rehypeCallout, splitCalloutParagraph } from "./rehypeCallout";
import { parseCalloutHeader, isCalloutSlice } from "./callout";
import type { Element } from "hast";

async function render(md: string, sanitize = false): Promise<string> {
  let p = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype);
  if (md.includes("<")) p = p.use(rehypeRaw);
  p = p.use(rehypeCallout);
  if (sanitize) p = p.use(rehypeSanitize, mdSanitizeSchema);
  const out = await p.use(rehypeStringify).process(md);
  return String(out);
}

/** Strip tags so we can assert "no content was swallowed". */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("parseCalloutHeader", () => {
  it("accepts all five GitHub kinds, case-insensitively", () => {
    for (const kind of ["note", "tip", "warning", "important", "caution"]) {
      expect(parseCalloutHeader(`[!${kind}]`)?.kind).toBe(kind);
      expect(parseCalloutHeader(`[!${kind.toUpperCase()}]`)?.kind).toBe(kind);
      expect(parseCalloutHeader(`[!${kind[0]!.toUpperCase()}${kind.slice(1)}]`)?.kind).toBe(kind);
    }
  });

  it("keeps a custom title", () => {
    expect(parseCalloutHeader("[!tip] 自定义标题")).toEqual({
      kind: "tip",
      title: "自定义标题",
    });
  });

  it("treats Obsidian fold markers as syntax, not title", () => {
    expect(parseCalloutHeader("[!note]-")).toEqual({ kind: "note", title: "" });
    expect(parseCalloutHeader("[!note]+ 折叠我")).toEqual({
      kind: "note",
      title: "折叠我",
    });
  });

  it("rejects unknown kinds and plain quotes", () => {
    expect(parseCalloutHeader("[!nope]")).toBeNull();
    expect(parseCalloutHeader("普通引用")).toBeNull();
    expect(parseCalloutHeader("[!tip]")).not.toBeNull();
  });
});

describe("isCalloutSlice", () => {
  it("recognises a quoted callout slice", () => {
    expect(isCalloutSlice("> [!TIP] 标题\n> 正文\n")).toBe(true);
    expect(isCalloutSlice("> 普通引用\n")).toBe(false);
  });
});

describe("splitCalloutParagraph", () => {
  const p = (md: string): Element =>
    unified().use(remarkParse).use(remarkGfm).parse(md).children[0] as unknown as Element;

  it("splits header line from the rest of the same paragraph", () => {
    const block = unified().use(remarkParse).parse("> [!tip] 标题\n> 正文一\n>\n> 正文二\n")
      .children[0] as unknown as Element;
    const header = block.children[0] as Element;
    const split = splitCalloutParagraph(header);
    expect(split?.kind).toBe("tip");
    expect(split?.title).toEqual([{ type: "text", value: "标题" }]);
    expect(split?.body).toEqual([{ type: "text", value: "正文一" }]);
    // Guard against the parser helper drifting.
    expect(p("> [!tip] x").type).toBe("blockquote");
  });
});

describe("rehypeCallout 预览卡片", () => {
  it("五种 callout 都出卡片，不再留裸 [!tip] 文本", async () => {
    const md = [
      "> [!note] 说明一下",
      "> note 正文",
      "",
      "> [!tip]",
      "> tip 正文",
      "",
      "> [!important] 重要",
      "> important 正文",
      "",
      "> [!warning] 注意",
      "> warning 正文",
      "",
      "> [!caution] 小心",
      "> caution 正文",
    ].join("\n");
    const html = await render(md);
    for (const kind of ["note", "tip", "important", "warning", "caution"]) {
      expect(html).toContain(`data-callout="${kind}"`);
      expect(html).toContain(`callout-${kind}`);
    }
    expect(html).not.toMatch(/\[!/);
    expect(html).not.toContain("<blockquote");
  });

  it("标题可自定义；缺省标题给中文名", async () => {
    const custom = await render("> [!TIP] 自定义标题\n> 正文\n");
    expect(custom).toMatch(/class="callout-title"[^>]*>自定义标题</);
    const fallback = await render("> [!warning]\n> 正文\n");
    expect(fallback).toMatch(/class="callout-title"[^>]*>注意</);
  });

  it("标题行后面紧跟的正文行不丢", async () => {
    const html = await render("> [!tip] 标题\n> 正文一\n>\n> 正文二\n");
    expect(textOf(html)).toBe("标题 正文一 正文二");
    expect((html.match(/<p>/g) || []).length).toBe(2);
  });

  it("正文里的行内语法（加粗 / 链接 / 行内码）仍走 Markdown", async () => {
    const html = await render("> [!note] 标题\n> 有 **粗体** 与 `code`\n");
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("普通引用不动", async () => {
    const html = await render("> 只是引用\n> 第二行\n");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("data-callout");
  });

  it("未知类型不动", async () => {
    const html = await render("> [!nope] x\n> y\n");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("data-callout");
  });

  it("嵌套 callout 由内向外转换，正文不重不漏", async () => {
    const html = await render(
      "> [!warning] 外层\n> 外层正文\n>\n> > [!tip] 内层\n> > 内层正文\n"
    );
    expect(html.match(/data-callout=/g)).toHaveLength(2);
    expect(textOf(html)).toBe("外层 外层正文 内层 内层正文");
    // 内层必须真的长在外层 body 里
    const outerBodyAt = html.indexOf("data-callout-body");
    expect(outerBodyAt).toBeGreaterThan(-1);
    expect(html.indexOf('data-callout="tip"')).toBeGreaterThan(outerBodyAt);
  });

  it("代码块里的 [!tip] 不转（只认 blockquote）", async () => {
    const html = await render("```md\n> [!tip] x\n```\n");
    expect(html).not.toContain("data-callout");
    expect(html).toContain("[!tip]");
  });

  it("转义成 HTML 的尖括号不会把 callout 认错", async () => {
    const html = await render("> [!note] 标题\n> a < b 且 c > d\n");
    expect(html).toContain("data-callout");
    expect(textOf(html)).toContain("a &#x3C; b 且 c > d");
  });

  it("清洗后 data-callout 仍在（MarkdownReader 才能按 kind 上色）", async () => {
    const html = await render("> [!tip] 标题\n> 正文\n", true);
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('class="callout callout-tip tip"');
  });

  it("data-src-* 从 blockquote 搬到卡片（点选编辑 / 定位不回归）", async () => {
    const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const md = "> [!tip] 标题\n> 正文\n";
    const hast = await parser.run(parser.parse(md));
    const block = hast.children[0] as Element;
    block.properties = { "data-src-start": 0, "data-src-end": 18, "data-src-line": 1 };
    const proc = unified().use(rehypeCallout);
    const ast = (await proc.run(hast)) as unknown as { children: Element[] };
    const card = ast.children[0]!;
    expect(card.properties?.["data-src-start"]).toBe(0);
    expect(card.properties?.["data-src-end"]).toBe(18);
    expect(card.properties?.["data-src-line"]).toBe(1);
    expect(card.properties?.["data-callout"]).toBe("tip");
  });
});
