import { describe, expect, it } from "vitest";
import { applyDocMeta, getDocMeta, matchesStatusFilter } from "./docMeta";
import type { Document } from "./types";

function md(content: string, path = "a.md"): Document {
  return {
    id: "1",
    path,
    type: "md",
    content,
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("docMeta", () => {
  it("reads and writes frontmatter fields", () => {
    const doc = md("---\ntitle: Hello\ntags: [a]\n---\n\n# Hi\n");
    const meta = getDocMeta(doc);
    expect(meta.title).toBe("Hello");
    expect(meta.tags).toEqual(["a"]);
    const next = applyDocMeta(doc.content, "md", {
      aliases: ["别名"],
      status: "evergreen",
      source: "https://example.com",
    });
    const again = getDocMeta({ ...doc, content: next });
    expect(again.aliases).toEqual(["别名"]);
    expect(again.status).toBe("evergreen");
    expect(again.source).toBe("https://example.com");
  });

  it("todo filter matches draft / 待整理", () => {
    expect(
      matchesStatusFilter(md("---\nstatus: draft\ntags: []\n---\n\nx\n"), "todo")
    ).toBe(true);
    expect(
      matchesStatusFilter(md("---\ntags: [待整理]\n---\n\nx\n"), "todo")
    ).toBe(true);
    expect(
      matchesStatusFilter(md("---\nstatus: evergreen\ntags: []\n---\n\nx\n"), "todo")
    ).toBe(false);
  });
});
