import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import {
  rehypeRecoverEmphasis,
  splitRecoveredEmphasis,
} from "./rehypeRecoverEmphasis";

async function render(md: string): Promise<string> {
  const out = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeRecoverEmphasis)
    .use(rehypeStringify)
    .process(md);
  return String(out);
}

describe("splitRecoveredEmphasis", () => {
  it("wraps **|A| …** as strong", () => {
    const parts = splitRecoveredEmphasis(
      "就是**|A| 维立方体的顶点与棱**——解释"
    );
    expect(parts).toEqual([
      { type: "text", value: "就是" },
      {
        type: "element",
        tagName: "strong",
        properties: {},
        children: [{ type: "text", value: "|A| 维立方体的顶点与棱" }],
      },
      { type: "text", value: "——解释" },
    ]);
  });

  it("leaves plain text alone", () => {
    expect(splitRecoveredEmphasis("没有加粗")).toEqual([
      { type: "text", value: "没有加粗" },
    ]);
  });
});

describe("rehypeRecoverEmphasis", () => {
  it("bolds cardinality inside Chinese notes", async () => {
    const html = await render(
      "规律：就是**|A| 维立方体的顶点与棱**——这解释了为什么 |P(A)| = 2^n。"
    );
    expect(html).toContain("<strong>|A| 维立方体的顶点与棱</strong>");
    expect(html).not.toContain("**|A|");
  });

  it("does not touch fenced code", async () => {
    const html = await render("```\n就是**|A| x**\n```\n");
    expect(html).toContain("**|A|");
    expect(html).not.toMatch(/<strong>[^<]*\|A\|/);
  });

  it("keeps already-parsed bold", async () => {
    const html = await render("就是 **|A| 维立方体的顶点与棱** ——解释");
    expect(html).toContain("<strong>|A| 维立方体的顶点与棱</strong>");
  });
});
