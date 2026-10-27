import { describe, expect, it } from "vitest";
import { clipboardHtmlToDoc, htmlToMarkdown, looksLikeRichHtml } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts basic rich html", () => {
    const md = htmlToMarkdown("<p>你好 <strong>世界</strong></p><ul><li>一项</li></ul>");
    expect(md).toMatch(/你好/);
    expect(md).toMatch(/\*\*世界\*\*/);
    expect(md).toMatch(/-\s+一项/);
  });

  it("converts headings and links", () => {
    const md = htmlToMarkdown('<h2>标题</h2><p><a href="https://example.com">链</a></p>');
    expect(md).toMatch(/## 标题/);
    expect(md).toMatch(/\[链\]\(https:\/\/example.com\)/);
  });
});

describe("looksLikeRichHtml", () => {
  it("detects rich vs empty", () => {
    expect(looksLikeRichHtml("<p>x</p>")).toBe(true);
    expect(looksLikeRichHtml("")).toBe(false);
  });
});

describe("clipboardHtmlToDoc", () => {
  it("builds md with frontmatter", () => {
    const doc = clipboardHtmlToDoc("<h1>剪来的页</h1><p>正文</p>", "md");
    expect(doc.mode).toBe("md");
    expect(doc.content).toMatch(/tags: \[剪藏\]/);
    expect(doc.content).toMatch(/剪来的页/);
  });

  it("wraps fragment as html snapshot", () => {
    const doc = clipboardHtmlToDoc("<p>hi</p>", "html");
    expect(doc.mode).toBe("html");
    expect(doc.content).toMatch(/<!DOCTYPE html>/i);
    expect(doc.content).toMatch(/<p>hi<\/p>/);
  });
});
