import { describe, expect, it } from "vitest";
import {
  documentToStandaloneHtml,
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

  it("uses frontmatter title", async () => {
    const html = await documentToStandaloneHtml(mdDoc());
    expect(html).toContain("<title>问候 · 琅嬛</title>");
    expect(html).toContain("<strong>粗体</strong>");
  });

  it("wraps markdown into a full document", async () => {
    const html = await documentToStandaloneHtml(mdDoc());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1");
    expect(html).toContain("粗体");
  });

  it("falls back to the filename when there is no title", async () => {
    const html = await documentToStandaloneHtml(mdDoc({ content: "只有正文" }));
    expect(html).toContain("你好");
  });

  it("passes through full html documents", async () => {
    const doc = mdDoc({
      type: "html",
      path: "页/a.html",
      content: "<!DOCTYPE html><html><body><p>Hi</p></body></html>",
    });
    const html = await documentToStandaloneHtml(doc);
    expect(html).toContain("<p>Hi</p>");
  });

  it("suggestExportFilename", () => {
    expect(suggestExportFilename(mdDoc(), "html")).toBe("你好.html");
    expect(suggestExportFilename(mdDoc(), "source")).toBe("你好.md");
  });

  it("accepts a plain string as content (old call shape)", async () => {
    const html = await documentToStandaloneHtml(mdDoc(), "# 覆盖\n\n新正文");
    expect(html).toContain("新正文");
  });
});
