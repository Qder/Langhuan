import { describe, expect, it } from "vitest";
import { renderMarkdownForExport } from "./renderMarkdown";
import { documentToStandaloneHtml } from "./standalone";
import type { Document } from "../types";

const doc = (over: Partial<Document> = {}): Document => ({
  id: "d1",
  path: "笔记/你好.md",
  type: "md",
  content: "",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const other = (over: Partial<Document> = {}): Document => ({
  id: "d2",
  path: "笔记/功能验收.md",
  type: "md",
  content: "# 功能验收",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const base = {
  content: "",
  docPath: "笔记/你好.md",
  docs: [doc(), other()],
};

describe("导出：callout 变成卡片", () => {
  it("note / tip / warning 都渲染成带 kind 的卡片", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "> [!note] 说明标题\n> 正文一\n\n> [!tip]\n> 提示\n\n> [!warning]\n> 小心\n",
    });
    expect(bodyHtml).toContain('class="callout callout-note note"');
    expect(bodyHtml).toContain('class="callout callout-tip tip"');
    expect(bodyHtml).toContain('class="callout callout-warning warning warn"');
    expect(bodyHtml).toContain('class="callout-title"');
    expect(bodyHtml).toContain("说明标题");
    // 标记行不能漏成正文
    expect(bodyHtml).not.toContain("[!note]");
    expect(bodyHtml).not.toContain("[!warning]");
  });

  it("只有标记没有标题时用中文默认名", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "> [!caution]\n> 危险\n",
    });
    expect(bodyHtml).toContain("小心");
  });
});

describe("导出：双链", () => {
  it("目标在导出范围内时变成可点的相对链接", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "见 [[功能验收]] 与 [[功能验收|别名]]。",
      hrefForDoc: (d) => (d.id === "d2" ? "功能验收.html" : null),
    });
    expect(bodyHtml).toContain('<a class="export-wiki export-wiki-link" href="功能验收.html">功能验收</a>');
    expect(bodyHtml).toContain(">别名</a>");
    expect(bodyHtml).not.toContain("[[");
  });

  it("目标不在本次导出范围时是不可点的胶囊，并说明原因", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "见 [[功能验收]]。",
      hrefForDoc: () => null,
    });
    expect(bodyHtml).toContain("export-wiki-outside");
    expect(bodyHtml).not.toContain("<a ");
    expect(bodyHtml).not.toContain("[[");
  });

  it("库内没有的目标标成 missing", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "见 [[不存在的笔记]]。",
    });
    expect(bodyHtml).toContain("export-wiki-missing");
  });

  it("带 #标题 时拼出锚点", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "见 [[功能验收#一 节|跳过去]]。",
      hrefForDoc: () => "功能验收.html",
    });
    expect(bodyHtml).toContain('href="功能验收.html#一-节"');
  });

  it("代码块里的 [[...]] 原样保留，不改写", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "```md\n[[功能验收]]\n```\n",
      hrefForDoc: () => "功能验收.html",
    });
    expect(bodyHtml).toContain("[[功能验收]]");
    expect(bodyHtml).not.toContain("export-wiki");
  });
});

describe("导出：图片", () => {
  it("能读到的资源改写 src", async () => {
    const seen: string[] = [];
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "![章](assets/seal.svg)",
      resolveAsset: async (p) => {
        seen.push(p);
        return "../assets/abc-seal.svg";
      },
    });
    expect(seen).toEqual(["笔记/assets/seal.svg"]);
    expect(bodyHtml).toContain('src="../assets/abc-seal.svg"');
  });

  it("读不到时渲染占位说明，不留碎图", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "![章](assets/missing.png)",
      resolveAsset: async () => null,
    });
    expect(bodyHtml).toContain("export-missing-media");
    expect(bodyHtml).toContain("图片未找到：笔记/assets/missing.png");
    expect(bodyHtml).not.toContain("<img");
  });

  it("库内 SVG 文档直接内联成 data URL（不依赖资产表）", async () => {
    const svgDoc = doc({
      id: "svg1",
      path: "笔记/assets/seal.svg",
      type: "html",
      content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    });
    const { bodyHtml } = await renderMarkdownForExport({
      content: "![印](assets/seal.svg)",
      docPath: "笔记/你好.md",
      docs: [doc(), svgDoc],
    });
    expect(bodyHtml).toContain("data:image/svg+xml");
  });

  it("外链图片不动", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "![x](https://example.com/a.png)",
      resolveAsset: async () => "should-not-be-used",
    });
    expect(bodyHtml).toContain('src="https://example.com/a.png"');
  });
});

describe("导出：普通链接", () => {
  it("指向库内文档的相对链接改成导出物路径", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "[验收](../笔记/功能验收.md)",
      hrefForDoc: () => "功能验收.html",
    });
    expect(bodyHtml).toContain('href="功能验收.html"');
  });

  it("指不到库内的相对链接降级成纯文本", async () => {
    const { bodyHtml } = await renderMarkdownForExport({
      ...base,
      content: "[外部文件](other.md)",
      hrefForDoc: () => null,
    });
    expect(bodyHtml).not.toContain("<a ");
    expect(bodyHtml).toContain("export-link-plain");
  });
});

describe("导出：单篇独立 HTML", () => {
  it("图片内联成 data URL", async () => {
    const html = await documentToStandaloneHtml(doc({ content: "![章](assets/seal.svg)" }), {
      content: "![章](assets/seal.svg)",
      readAsset: async () => ({ mime: "image/png", base64: "AAA" }),
    });
    expect(html).toContain("data:image/png;base64,AAA");
  });

  it("双链目标在别的文件里 → 不可点，但文字保留", async () => {
    const html = await documentToStandaloneHtml(doc({ content: "见 [[功能验收]]" }), {
      content: "见 [[功能验收]]",
      docs: [doc(), other()],
    });
    expect(html).toContain("export-wiki-outside");
    expect(html).toContain(">功能验收<");
  });

  it("callout 在单篇里也是卡片", async () => {
    const html = await documentToStandaloneHtml(doc({ content: "> [!tip]\n> 记住这个\n" }));
    expect(html).toContain("callout-tip");
    expect(html).toContain("提示");
  });

  it("自带 callout / 高亮 / 占位样式（离线可读）", async () => {
    const html = await documentToStandaloneHtml(doc({ content: "# x" }));
    expect(html).toContain(".prose .callout");
    expect(html).toContain(".hljs-keyword");
    expect(html).toContain(".export-missing-media");
    expect(html).toContain(".export-wiki-missing");
  });
});
