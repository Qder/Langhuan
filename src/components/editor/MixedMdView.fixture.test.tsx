// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

const SOURCE = [
  "# 标题",
  "紧跟标题的正文",
  "",
  "```js",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "$$",
  "",
  "a + b",
  "",
  "$$",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "结尾段落",
].join("\n");

const doc = {
  id: "doc_mixed_fixture",
  type: "md" as const,
  path: "笔记/fixture.md",
  title: "标题",
  content: SOURCE,
  updatedAt: 0,
  createdAt: 0,
};

vi.mock("@/lib/store", () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      getContent: () => SOURCE,
      setDraft: vi.fn(),
      readingPrefs: { fontSize: 17, lineWidth: 740, lineHeight: 1.95, paragraphSpacing: 0.85, zoom: 1, focusMode: false, typewriterMode: false },
      viewMode: "mixed",
    }),
}));

import { MixedMdView } from "./MixedMdView";
import { splitMarkdownBlocks } from "@/lib/mdBlocks";

const mounted: { unmount: () => void }[] = [];

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MixedMdView doc={doc as never} />);
  });
  mounted.push({
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  });
  return host;
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

/** 每块的文本；激活块是 textarea，其余是渲染后的 DOM。 */
function blockTexts(host: HTMLElement): string[] {
  const wrappers = [...host.querySelectorAll(":scope > div > div > div")];
  return wrappers
    .filter((el) => !el.textContent?.startsWith("+ 添加块"))
    .map((el) => {
      const ta = el.querySelector("textarea");
      if (ta) return ta.value;
      return (el.textContent || "").trim();
    });
}

describe("MixedMdView 分块渲染", () => {
  it("样例 md 的分块数量符合 splitMarkdownBlocks", () => {
    const expected = splitMarkdownBlocks(SOURCE);
    // 标题独占、紧随正文另块、代码/公式/表格各自成块 → 5 块
    expect(expected.map((b) => b.text)).toEqual([
      "# 标题",
      "紧跟标题的正文",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
      "$$\n\na + b\n\n$$",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "结尾段落",
    ]);

    const host = render();
    const texts = blockTexts(host);
    expect(texts).toHaveLength(expected.length);
  });

  it("代码块内部的空行没有被拆成两块", () => {
    const host = render();
    // 首个块是激活态的 textarea
    const ta = host.querySelector("textarea");
    expect(ta?.value).toBe("# 标题");

    // 代码块应该作为一个整体出现，且有两条代码行
    const blocks = [...host.querySelectorAll(":scope > div > div > div")];
    const codeBlock = blocks.find((b) => (b.textContent || "").includes("const a = 1"));
    expect(codeBlock).toBeTruthy();
    expect(codeBlock!.textContent).toContain("const b = 2");
  });

  it("每块都带打字机定位用的 data 属性", () => {
    const host = render();
    const blocks = [...host.querySelectorAll("[data-md-block]")];
    expect(blocks).toHaveLength(splitMarkdownBlocks(SOURCE).length);
    // 只有当前编辑块标记为 active，滚动逻辑靠它找目标
    const actives = blocks.filter((b) => b.getAttribute("data-active") === "true");
    expect(actives).toHaveLength(1);
    expect(actives[0]!.querySelector("textarea")).toBeTruthy();
  });

  it("滚动容器有 data-md-scroll 标记（混合模式可能同屏多份，不能用 id）", () => {
    const host = render();
    const scroller = host.querySelector("[data-md-scroll]");
    expect(scroller).toBeTruthy();
    // 块必须在这个容器里，否则 closest() 找不到滚动目标
    expect(scroller!.querySelector("[data-md-block]")).toBeTruthy();
  });
});
