import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { rehypeToc } from "./rehypeToc";
import { mdSanitizeSchema } from "./mdSanitizeSchema";

async function render(md: string, withSanitize = true): Promise<string> {
  const p = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeToc);
  if (withSanitize) p.use(rehypeSanitize, mdSanitizeSchema);
  p.use(rehypeStringify, { allowDangerousHtml: true });
  return String(await p.process(md));
}

const DOC = `# 标题

<!-- toc -->

## 小节 A

### 小节 A-1

## 小节 B
`;

describe("rehypeToc", () => {
  it("标记换成带锚点的目录，层级用嵌套列表表达", async () => {
    const html = await render(DOC);
    expect(html).toContain("lh-toc");
    expect(html).toContain('href="#标题"');
    expect(html).toContain('href="#小节-a"');
    // 标记本身不能漏进输出。
    expect(html).not.toContain("<!-- toc -->");
  });

  it("同层标题是兄弟，不会被前一条吞进去", async () => {
    const html = await render(DOC);
    const toc = html.slice(html.indexOf("lh-toc"), html.indexOf("</div>"));
    // 小节 A 与 小节 B 都在第二层：B 必须出现在 A 的子列表之外。
    const a = toc.indexOf('href="#小节-a"');
    const b = toc.indexOf('href="#小节-b"');
    const deep = toc.indexOf('href="#小节-a-1"');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    // A-1 是 A 的子项，夹在 A 与 B 之间。
    expect(deep).toBeGreaterThan(a);
    expect(deep).toBeLessThan(b);
    // 嵌套层次：A-1 前面比 A 多一层 <ul>。
    expect(toc.slice(a, b)).toContain("<ul>");
  });

  it("文档从 h2 起时按最小层级归一（不留空的 h1 层）", async () => {
    const html = await render("## 一\n\n<!-- toc -->\n\n### 一之一\n");
    const start = html.indexOf('<div class="lh-toc"');
    const toc = html.slice(start, html.indexOf("</div>", start));
    // 第一项直接是 <ul><li>：没有为「空的 h1 层」补出来的 <ul><li><ul>。
    expect(toc).toContain("<ul><li>");
    expect(toc).not.toContain("<ul><li><ul><li>");
    expect(toc.indexOf('href="#一"')).toBeGreaterThan(-1);
    expect(toc.indexOf('href="#一之一"')).toBeGreaterThan(toc.indexOf('href="#一"'));
  });

  it("目录项 id 与标题 id 完全一致（点了真能跳）", async () => {
    const html = await render(DOC);
    const headingIds = [...html.matchAll(/<h[1-4] id="([^"]+)"/g)].map((m) => m[1]);
    const tocIds = [...html.matchAll(/data-toc-target="([^"]+)"/g)].map((m) => m[1]);
    expect(tocIds).toEqual(headingIds);
  });

  it("h5/h6 不进目录（与大纲深度一致）", async () => {
    const html = await render("# A\n\n<!-- toc -->\n\n##### 太深\n\n## 正常\n");
    // 标题本身当然还在正文里，要看的是目录里有没有它的锚点。
    expect(html).not.toContain('href="#太深"');
    expect(html).toContain('href="#正常"');
  });

  it("没有标题时给可见提示，而不是空白", async () => {
    const html = await render("<!-- toc -->\n\n只有正文\n");
    expect(html).toContain("lh-toc-empty");
    expect(html).toContain("目录为空");
  });

  it("没有标记就不生成目录（不擅自加）", async () => {
    const html = await render("# A\n\n## B\n");
    expect(html).not.toContain("data-toc");
  });

  it("多个标记各展开一份（用户自己负责，不去重）", async () => {
    const html = await render("# A\n\n<!-- toc -->\n\n## B\n\n<!-- toc -->\n");
    expect([...html.matchAll(/class="lh-toc"/g)]).toHaveLength(2);
  });

  it("sanitize 之后 href 与 data-toc 仍在（顺序写对才不会被吃掉）", async () => {
    const html = await render(DOC, true);
    expect(html).toContain("lh-toc");
    expect(html).toContain('href="#标题"');
  });
});
