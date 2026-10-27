import { describe, expect, it } from "vitest";
import { joinMarkdownBlocks, splitMarkdownBlocks } from "./mdBlocks";

describe("splitMarkdownBlocks", () => {
  it("splits headings and paragraphs", () => {
    const src = "# Title\n\nHello\n\n## Sub\n\nWorld";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0].text.startsWith("# Title")).toBe(true);
  });

  it("keeps fenced code together", () => {
    const src = "Intro\n\n```js\nconst a = 1;\n```\n\nOutro";
    const blocks = splitMarkdownBlocks(src);
    const code = blocks.find((b) => b.text.includes("```js"));
    expect(code?.text).toContain("const a = 1");
    expect(code?.text).toContain("```");
  });

  it("roundtrips via join", () => {
    const texts = ["# A", "para", "- x"];
    expect(joinMarkdownBlocks(texts)).toBe("# A\n\npara\n\n- x");
  });
});
