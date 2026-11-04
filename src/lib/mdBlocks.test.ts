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

  it("exposes stable source-range starts for block keys", () => {
    const src = "# A\n\npara one\n\n## B\n\npara two";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.every((b) => typeof b.start === "number")).toBe(true);
    // Editing the last block must not shift earlier starts.
    const earlier = blocks.slice(0, -1).map((b) => b.start);
    const rebuilt = splitMarkdownBlocks(
      joinMarkdownBlocks([...blocks.slice(0, -1).map((b) => b.text), "para two edited"])
    );
    expect(rebuilt.slice(0, -1).map((b) => b.start)).toEqual(earlier);
  });

  it("join/split roundtrip keeps drafts aligned with body", () => {
    const drafts = ["# Title", "Hello world", "- item"];
    const body = joinMarkdownBlocks(drafts);
    const again = splitMarkdownBlocks(body).map((b) => b.text);
    expect(joinMarkdownBlocks(again)).toBe(body);
  });

