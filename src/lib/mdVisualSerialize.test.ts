import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { replaceRange } from "./mdInlineEdit";
import {
  classifyMdBlock,
  isSourceEditType,
  isVisualEditableType,
  serializeVisualBlock,
  type VisualBlockType,
} from "./mdVisualSerialize";

function el(html: string): HTMLElement {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const node = dom.window.document.body.firstElementChild;
  if (!node) throw new Error("no element");
  return node as HTMLElement;
}

describe("classifyMdBlock", () => {
  it("classifies heading / list / paragraph / mono", () => {
    expect(classifyMdBlock("## 记录\n")).toBe("heading");
    expect(classifyMdBlock("# Title")).toBe("heading");
    expect(classifyMdBlock("- [ ] 题目\n")).toBe("listItem");
    expect(classifyMdBlock("1. first\n")).toBe("listItem");
    expect(classifyMdBlock("* item")).toBe("listItem");
    expect(classifyMdBlock("hello world\n")).toBe("paragraph");
    expect(classifyMdBlock("```js\nX\n```\n")).toBe("code");
    expect(classifyMdBlock("```mermaid\ngraph TD\nA-->B\n```")).toBe(
      "mermaid"
    );
    expect(classifyMdBlock("$$\\alpha$$\n")).toBe("math");
    expect(classifyMdBlock("> quote\n")).toBe("blockquote");
    expect(classifyMdBlock("> [!tip] Hi\n")).toBe("callout");
    expect(classifyMdBlock("| a | b |\n| - | - |\n")).toBe("table");
  });

  it("visual vs source edit split", () => {
    expect(isVisualEditableType("heading")).toBe(true);
    expect(isVisualEditableType("paragraph")).toBe(true);
    expect(isVisualEditableType("listItem")).toBe(true);
    expect(isVisualEditableType("blockquote")).toBe(true);
    expect(isSourceEditType("code")).toBe(true);
    expect(isSourceEditType("math")).toBe(true);
    expect(isSourceEditType("table")).toBe(true);
    expect(isSourceEditType("callout")).toBe(true);
  });
});

describe("serializeVisualBlock heading", () => {
  it("keeps ATX prefix when renaming visible text", () => {
    const node = el("<h2>总结</h2>");
    const next = serializeVisualBlock({
      originalSlice: "## 记录\n",
      blockType: "heading",
      element: node,
    });
    expect(next).toBe("## 总结\n");
  });

  it("preserves hash count and optional closing hashes", () => {
    const node = el("<h3>新</h3>");
    expect(
      serializeVisualBlock({
        originalSlice: "### 旧 ##",
        blockType: "heading",
        element: node,
      })
    ).toBe("### 新 ##");
  });

  it("empty heading keeps prefix (does not emit hashes into body)", () => {
    const node = el("<h2></h2>");
    expect(
      serializeVisualBlock({
        originalSlice: "## 记录\n",
        blockType: "heading",
        element: node,
      })
    ).toBe("## \n");
  });

  it("replaceRange leaves neighbors and front matter intact", () => {
    const fm = "---\ntitle: Demo\n---\n\n";
    const src = fm + "# 日\n\n## 记录\n\npara\n";
    const start = src.indexOf("## 记录");
    const end = start + "## 记录\n".length;
    const slice = src.slice(start, end);
    const node = el("<h2>总结</h2>");
    const nextSlice = serializeVisualBlock({
      originalSlice: slice,
      blockType: "heading",
      element: node,
    });
    const next = replaceRange(src, start, end, nextSlice);
    expect(next.startsWith(fm)).toBe(true);
    expect(next).toBe(fm + "# 日\n\n## 总结\n\npara\n");
    expect(next.slice(0, start)).toBe(src.slice(0, start));
  });
});

describe("serializeVisualBlock paragraph", () => {
  it("plain paragraph replaces visible text only", () => {
    const node = el("<p>hola mundo</p>");
    expect(
      serializeVisualBlock({
        originalSlice: "hello world\n",
        blockType: "paragraph",
        element: node,
      })
    ).toBe("hola mundo\n");
  });

  it("keeps **bold** and [[wikilink]] when adjacent text changes", () => {
    const node = el(
      '<p>前 <strong>粗</strong> 中 <button class="wiki-link">页面</button> 后改</p>'
    );
    const next = serializeVisualBlock({
      originalSlice: "前 **粗** 中 [[页面]] 后\n",
      blockType: "paragraph",
      element: node,
    });
    expect(next).toContain("**粗**");
    expect(next).toContain("[[页面]]");
    expect(next).toContain("后改");
    expect(next.endsWith("\n")).toBe(true);
  });

  it("keeps aliased wikilink marker via conservation", () => {
    const node = el(
      '<p>见 <button class="wiki-link">别名</button> 即可</p>'
    );
    const next = serializeVisualBlock({
      originalSlice: "见 [[目标|别名]] 即可\n",
      blockType: "paragraph",
      element: node,
    });
    expect(next).toBe("见 [[目标|别名]] 即可\n");
  });

  it("maps em/code/link", () => {
    const node = el(
      '<p><em>斜</em>与<code>x</code>和<a href="https://a.test">链</a></p>'
    );
    const next = serializeVisualBlock({
      originalSlice: "*斜*与`x`和[链](https://a.test)\n",
      blockType: "paragraph",
      element: node,
    });
    expect(next).toBe("*斜*与`x`和[链](https://a.test)\n");
  });
});

describe("serializeVisualBlock listItem", () => {
  it("keeps task checkbox marker", () => {
    const node = el(
      '<li><input type="checkbox" disabled=""> 新题</li>'
    );
    const next = serializeVisualBlock({
      originalSlice: "- [ ] 题目\n",
      blockType: "listItem",
      element: node,
    });
    expect(next).toBe("- [ ] 新题\n");
  });

  it("keeps ordered marker and indent", () => {
    const node = el("<li>beta</li>");
    expect(
      serializeVisualBlock({
        originalSlice: "  1. alpha\n",
        blockType: "listItem",
        element: node,
      })
    ).toBe("  1. beta\n");
  });

  it("keeps checked task state", () => {
    const node = el(
      '<li><input type="checkbox" checked disabled=""> done</li>'
    );
    expect(
      serializeVisualBlock({
        originalSlice: "- [x] old\n",
        blockType: "listItem",
        element: node,
      })
    ).toBe("- [x] done\n");
  });
});

describe("serializeVisualBlock blockquote", () => {
  it("keeps > prefix", () => {
    const node = el("<blockquote><p>新引用</p></blockquote>");
    expect(
      serializeVisualBlock({
        originalSlice: "> 旧引用\n",
        blockType: "blockquote",
        element: node,
      })
    ).toBe("> 新引用\n");
  });
});

describe("serializeVisualBlock mono safety", () => {
  it("returns original for code/math types", () => {
    const node = el("<pre><code>x</code></pre>");
    const slice = "```\nx\n```\n";
    expect(
      serializeVisualBlock({
        originalSlice: slice,
        blockType: "code",
        element: node,
      })
    ).toBe(slice);
  });
});

describe("roundtrip via replaceRange", () => {
  function roundtrip(
    src: string,
    slice: string,
    blockType: VisualBlockType,
    html: string
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
    expect(next.slice(0, start)).toBe(src.slice(0, start));
    return { next, nextSlice, start, end };
  }

  it("heading rename is byte-local", () => {
    const src = "intro\n\n## 记录\n\n## 今日焦点\n";
    const { next } = roundtrip(src, "## 记录\n", "heading", "<h2>总结</h2>");
    expect(next).toBe("intro\n\n## 总结\n\n## 今日焦点\n");
  });

  it("paragraph neighbors unchanged", () => {
    const src = "A\n\nmid para\n\nB\n";
    const { next } = roundtrip(src, "mid para\n", "paragraph", "<p>MID</p>");
    expect(next).toBe("A\n\nMID\n\nB\n");
  });

  it("task list item neighbors unchanged", () => {
    const src = "list:\n\n- [ ] 题目\n- [ ] 其它\n";
    const { next } = roundtrip(
      src,
      "- [ ] 题目\n",
      "listItem",
      '<li><input type="checkbox" disabled=""> 新题</li>'
    );
    expect(next).toBe("list:\n\n- [ ] 新题\n- [ ] 其它\n");
  });
});
