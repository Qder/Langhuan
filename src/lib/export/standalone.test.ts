import { describe, expect, it } from "vitest";
import {
  documentToStandaloneHtml,
  mdBodyToHtml,
  suggestExportFilename,
  escapeHtml,
} from "./standalone";
import type { Document } from "../types";

const mdDoc = (over: Partial<Document> = {}): Document => ({
  id: "1",
  path: "笔记/你好.md",
  type: "md",
  content: "---\ntitle: 问候\ntags: []\n---\n\n# 你好\n\n这是 **粗体**。\n",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("export standalone", () => {
  it("escapes html", () => {
    expect(escapeHtml(`a<b>"&`)).toBe("a&lt;b&gt;&quot;&amp;");
  });

  it("mdBodyToHtml uses frontmatter title", () => {
    const { title, bodyHtml } = mdBodyToHtml(mdDoc().content);
    expect(title).toBe("问候");
    expect(bodyHtml).toContain("<strong>粗体</strong>");
  });

  it("documentToStandaloneHtml wraps markdown", () => {
    const html = documentToStandaloneHtml(mdDoc());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("问候");
    expect(html).toContain("粗体");
  });

  it("passes through full html documents", () => {
    const doc = mdDoc({
      type: "html",
      path: "页/a.html",
      content: "<!DOCTYPE html><html><body><p>Hi</p></body></html>",
    });
    const html = documentToStandaloneHtml(doc);
    expect(html).toContain("<p>Hi</p>");
  });

  it("suggestExportFilename", () => {
    expect(suggestExportFilename(mdDoc(), "html")).toBe("你好.html");
    expect(suggestExportFilename(mdDoc(), "source")).toBe("你好.md");
  });
});
