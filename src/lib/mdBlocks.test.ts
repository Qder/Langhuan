import { describe, expect, it } from "vitest";
import { joinMarkdownBlocks, splitMarkdownBlocks } from "./mdBlocks";

describe("splitMarkdownBlocks", () => {
  it("splits headings and paragraphs", () => {
    const src = "# Title\n\nHello\n\n## Sub\n\nWorld";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0]!.text.startsWith("# Title")).toBe(true);
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

describe("splitMarkdownBlocks — 块内空行不打断", () => {
  it("围栏代码块内部的空行不切块（fixture）", () => {
    const src = [
      "```js",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
      "",
      "尾注",
    ].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe("```js\nconst a = 1;\n\nconst b = 2;\n```");
    expect(blocks[1]!.text).toBe("尾注");
  });

  it("四反引号围栏里的三反引号只是内容（fixture）", () => {
    const src = ["````md", "```", "inner", "```", "````", "", "outro"].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(2);
    // 整块保留，内部的 ``` 没有被当成闭合围栏
    expect(blocks[0]!.text).toBe("````md\n```\ninner\n```\n````");
    expect(blocks[1]!.text).toBe("outro");
  });

  it("~~~ 围栏同样整体成块", () => {
    const src = ["~~~py", "x = 1", "", "y = 2", "~~~", "text"].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toContain("y = 2");
    expect(blocks[1]!.text).toBe("text");
  });

  it("未闭合的围栏一直延伸到文件末尾，不在中途拆碎", () => {
    const src = ["```js", "still typing", "", "more"].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe(src);
  });

  it("$$ 公式块内部的空行不切块（fixture）", () => {
    const src = ["$$", "", "a + b", "", "= c", "", "$$", "", "正文"].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe("$$\n\na + b\n\n= c\n\n$$");
    expect(blocks[1]!.text).toBe("正文");
  });

  it("单行 $$...$$ 自成一块", () => {
    const src = "$$a+b$$\n\ntext";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual(["$$a+b$$", "text"]);
  });

  it("表格不与相邻正文粘连，也不被空行拆开（fixture）", () => {
    const src = [
      "intro",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "after",
    ].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual([
      "intro",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "after",
    ]);
  });
});

describe("splitMarkdownBlocks — 标题始终独占一块", () => {
  it("标题前的正文切开", () => {
    const src = "para line\n## Heading\nbody after";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual(["para line", "## Heading", "body after"]);
  });

  it("标题后紧接的正文另起一块（strict）", () => {
    const src = ["## H", "正文紧跟", "", "para"].join("\n");
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual(["## H", "正文紧跟", "para"]);
  });

  it("标题不被当成段落的续行", () => {
    const src = "# A\ntext A\n# B\ntext B";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual(["# A", "text A", "# B", "text B"]);
  });

  it("正文里的 # 不算标题", () => {
    const src = "text\n#hashtag\nmore";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(1);
  });
});

describe("splitMarkdownBlocks — 维持原行为的部分", () => {
  it("松散列表照旧按空行拆开", () => {
    const src = "- a\n\n- b";
    expect(splitMarkdownBlocks(src).map((b) => b.text)).toEqual(["- a", "- b"]);
  });
});

describe("block source ranges", () => {
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

  it("每块的 start/end 与 text 自洽", () => {
    const src = [
      "# T",
      "",
      "```js",
      "",
      "code",
      "```",
      "",
      "| a |",
      "|---|",
      "",
      "尾",
    ].join("\n");
    for (const b of splitMarkdownBlocks(src)) {
      expect(src.slice(b.start, b.end)).toBe(b.text);
    }
  });

  it("特殊块（代码/公式/表格/标题）经 join 后仍是同一批块", () => {
    const src = [
      "# H",
      "$$",
      "",
      "x",
      "",
      "$$",
      "```js",
      "",
      "y",
      "```",
      "| a |",
      "|---|",
    ].join("\n");
    const first = splitMarkdownBlocks(src).map((b) => b.text);
    const again = splitMarkdownBlocks(joinMarkdownBlocks(first)).map((b) => b.text);
    expect(joinMarkdownBlocks(again)).toBe(joinMarkdownBlocks(first));
  });
});
