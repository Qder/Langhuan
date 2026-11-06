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
      // 两份 fixture 共用这个 store mock，所以按 docId 取内容，
      // 不能写死 SOURCE —— 否则第二个 fixture 会悄悄渲染成第一个。
      getContent: (id?: string) =>
        id === "doc_mixed_crlf" ? CRLF_SOURCE : SOURCE,
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

const CRLF_SOURCE = [
  "开头一句",
  "",
  "```python",
  "def f():",
  "",
  "    return 1",
  "```",
  "",
  "结尾",
].join("\r\n");

const crlfDoc = {
  id: "doc_mixed_crlf",
  type: "md" as const,
  path: "笔记/crlf.md",
  title: "crlf",
  content: CRLF_SOURCE,
  updatedAt: 0,
  createdAt: 0,
};

function renderCrlf() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MixedMdView doc={crlfDoc as never} />);
  });
  mounted.push({
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  });
  return host;
}

describe("MixedMdView —— 围栏里的空行不碎（fixture）", () => {
  it("CRLF 源：代码块仍是一块，内部的空行没有被切成两块", () => {
    expect(splitMarkdownBlocks(CRLF_SOURCE).map((b) => b.text)).toEqual([
      "开头一句",
      "```python\r\ndef f():\r\n\r\n    return 1\r\n```",
      "结尾",
    ]);

    const host = renderCrlf();
    const wrappers = [...host.querySelectorAll("[data-md-block]")];
    expect(wrappers).toHaveLength(3);

    const code = wrappers.find((b) => (b.textContent || "").includes("def f():"));
    expect(code).toBeTruthy();
    // 空行后的那一行必须还在同一块里
    expect(code!.textContent).toContain("return 1");
    // 而且只渲染出一个代码块外壳
    expect(code!.querySelectorAll("pre").length).toBe(1);
  });
});

/** 在 textarea 里把光标放到末尾并按回车（React 合成事件，走真实 onKeyDown）。 */
function pressEnterAtEnd(ta: HTMLTextAreaElement) {
  act(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
  });
}

describe("MixedMdView —— 行首轻量语法（fixture）", () => {
  it("列表行回车自动续上同一个标记", () => {
    const host = renderCrlf();
    const ta = host.querySelector("textarea")!;
    // 第一个块是激活态；把它改成列表行再按回车
    act(() => {
      ta.value = "- 第一项";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const live = host.querySelector("textarea")!;
    pressEnterAtEnd(live);
    const after = host.querySelector("textarea")!.value;
    expect(after).toBe("- 第一项\n- ");
  });

  it("空列表项再回车退出列表（清掉标记，不留空项）", () => {
    const host = renderCrlf();
    const ta = host.querySelector("textarea")!;
    act(() => {
      ta.value = "- ";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const live = host.querySelector("textarea")!;
    pressEnterAtEnd(live);
    expect(host.querySelector("textarea")!.value).toBe("");
  });
});
