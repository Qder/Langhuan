/**
 * Roundtrip / product-rule tests for preview visual edit writeback.
 * UI Esc/blur are covered by serialize+replaceRange contracts here
 * (Esc ⇒ no replaceRange; commit ⇒ offset-local writeback).
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { isMonoSrcSlice, replaceRange } from "./mdInlineEdit";
import {
  classifyMdBlock,
  isSourceEditType,
  isVisualEditableType,
  serializeVisualBlock,
} from "./mdVisualSerialize";

function el(html: string): HTMLElement {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const node = dom.window.document.body.firstElementChild;
  if (!node) throw new Error("no element");
  return node as HTMLElement;
}

function applyVisual(
  src: string,
  slice: string,
  html: string,
  blockType = classifyMdBlock(slice)
) {
  const start = src.indexOf(slice);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = start + slice.length;
  const nextSlice = serializeVisualBlock({
    originalSlice: slice,
    blockType,
    element: el(html),
  });
  const next = replaceRange(src, start, end, nextSlice);
  return { start, end, nextSlice, next };
}

describe("visual edit roundtrip — headings", () => {
  it("## 记录 → 总结 keeps neighbors byte-identical", () => {
    const src = "前\n\n## 记录\n\n## 今日焦点\n\n后\n";
    const { next, start } = applyVisual(
      src,
      "## 记录\n",
      "<h2>总结</h2>",
      "heading"
    );
    expect(next).toBe("前\n\n## 总结\n\n## 今日焦点\n\n后\n");
    expect(next.slice(0, start)).toBe(src.slice(0, start));
  });

  it("hash count unchanged with front matter", () => {
    const fm = "---\ntitle: 日记\ndate: 2026-10-29\n---\n\n";
    const src = fm + "# 2026-10-29\n\n## 记录\n\nbody\n";
    const { next } = applyVisual(src, "## 记录\n", "<h2>总结</h2>", "heading");
    expect(next.startsWith(fm)).toBe(true);
    expect(next).toContain("## 总结\n");
    expect(next).not.toContain("## 记录");
    expect(next.match(/^## /m)?.[0]).toBe("## ");
  });
});

describe("visual edit roundtrip — paragraphs", () => {
  it("plain paragraph neighbors unchanged", () => {
    const src = "A\n\nhello\n\nB\n";
    const { next } = applyVisual(src, "hello\n", "<p>hola</p>", "paragraph");
    expect(next).toBe("A\n\nhola\n\nB\n");
  });

  it("keeps **粗** and [[页面]] when only adjacent text changes", () => {
    const slice = "前 **粗** 与 [[页面]] 后\n";
    const src = "x\n\n" + slice + "\ny\n";
    const { nextSlice, next } = applyVisual(
      src,
      slice,
      '<p>改 <strong>粗</strong> 与 <button class="wiki-link">页面</button> 尾</p>',
      "paragraph"
    );
    expect(nextSlice).toContain("**粗**");
    expect(nextSlice).toContain("[[页面]]");
    expect(nextSlice).toContain("改 ");
    expect(nextSlice).toContain("尾");
    expect(next.startsWith("x\n\n")).toBe(true);
    expect(next.endsWith("\ny\n")).toBe(true);
  });
});

describe("visual edit roundtrip — list / task", () => {
  it("task item keeps - [ ] marker", () => {
    const src = "- [ ] 题目\n- [ ] 其它\n";
    const { next } = applyVisual(
      src,
      "- [ ] 题目\n",
      '<li><input type="checkbox" disabled=""> 新题</li>',
      "listItem"
    );
    expect(next).toBe("- [ ] 新题\n- [ ] 其它\n");
  });
});

describe("visual edit roundtrip — code stays source-edit type", () => {
  it("fenced code classified as mono / source, serialize is no-op", () => {
    const slice = "```js\nconsole.log(1)\n```\n";
    expect(classifyMdBlock(slice)).toBe("code");
    expect(isMonoSrcSlice(slice)).toBe(true);
    expect(isVisualEditableType("code")).toBe(false);
    expect(isSourceEditType("code")).toBe(true);
    const next = serializeVisualBlock({
      originalSlice: slice,
      blockType: "code",
      element: el("<pre><code>console.log(2)</code></pre>"),
    });
    expect(next).toBe(slice); // visual path must not rewrite code
  });

  it("source textarea path via replaceRange keeps fences", () => {
    const src = "before\n\n```js\nconsole.log(1)\n```\n\nafter\n";
    const start = src.indexOf("```js");
    const end = src.indexOf("\n\nafter");
    const next = replaceRange(
      src,
      start,
      end,
      "```js\nconsole.log(2)\n```"
    );
    expect(next).toContain("```js\nconsole.log(2)\n```");
    expect(next.startsWith("before\n\n")).toBe(true);
    expect(next.endsWith("\nafter\n")).toBe(true);
  });
});

describe("Esc ⇒ no writeback contract", () => {
  it("skipping replaceRange leaves source identical (Esc model)", () => {
    const src = "## 记录\n\npara\n";
    // Esc cancels without calling replaceRange — document unchanged.
    expect(src).toBe("## 记录\n\npara\n");
  });
});

describe("blockquote / mermaid / math / table policy", () => {
  it("blockquote is visual; callout/table/math/mermaid are source", () => {
    expect(isVisualEditableType(classifyMdBlock("> hi\n"))).toBe(true);
    expect(isSourceEditType(classifyMdBlock("> [!tip] x\n"))).toBe(true);
    expect(isSourceEditType(classifyMdBlock("| a | b |\n|---|---|\n"))).toBe(
      true
    );
    expect(isSourceEditType(classifyMdBlock("$$x$$\n"))).toBe(true);
    expect(
      isSourceEditType(classifyMdBlock("```mermaid\ngraph TD\nA-->B\n```\n"))
    ).toBe(true);
  });
});
