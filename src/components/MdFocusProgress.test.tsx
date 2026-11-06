// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MdFocusExitButton } from "./MdFocusExitButton";
import { ReadingProgress } from "./ReadingProgress";
import { READER_SCROLL_ID, scrollPercentOf } from "@/lib/useReadingProgress";

const setMdFocusMode = vi.fn();
const setStatus = vi.fn();

let htmlScrollPercent = 0;
let focusType: "md" | "html" = "md";

const doc = {
  id: "doc_1",
  type: "md" as const,
  path: "笔记/离散数学/集合.md",
  content: "# 集合\n\n## 定义\n\n## 运算\n",
  updatedAt: 0,
  createdAt: 0,
};

vi.mock("@/lib/store", () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      setMdFocusMode,
      setStatus,
      readingPrefs: { typewriterMode: false },
      setReadingPrefs: vi.fn(),
      viewMode: "source",
      getActive: () => ({ ...doc, type: focusType }),
      documents: [doc],
      getContent: () => doc.content,
      annotations: [],
      assetsForDoc: () => [],
      htmlScrollPercent,
      htmlImmersive: false,
      requestOpenDoc: vi.fn(),
      setDraft: vi.fn(),
      saveDoc: vi.fn(),
      updateAnnotation: vi.fn(),
      removeAnnotation: vi.fn(),
      applyLocateResult: vi.fn(),
      requestPreviewLocate: vi.fn(),
    }),
}));

/** 1000 高内容 / 400 视口 → 600 可滚。 */
function mountScroller(scrollTop = 0) {
  const el = document.createElement("div");
  el.id = READER_SCROLL_ID;
  document.body.appendChild(el);
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  setMdFocusMode.mockReset();
  setStatus.mockReset();
  htmlScrollPercent = 0;
  focusType = "md";
  document.body.innerHTML = "";
});

describe("scrollPercentOf", () => {
  it("按 scrollTop / (scrollHeight - clientHeight) 算百分比", () => {
    expect(scrollPercentOf(null)).toBe(0);
    expect(scrollPercentOf({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })).toBe(0);
    expect(scrollPercentOf({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 })).toBe(50);
    expect(scrollPercentOf({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(100);
  });

  it("不可滚（内容比视口短）读作 0，不产生 NaN", () => {
    expect(scrollPercentOf({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toBe(0);
    expect(scrollPercentOf({ scrollTop: 0, scrollHeight: 100, clientHeight: 400 })).toBe(0);
  });
});

describe("专注浮动条上的阅读进度", () => {
  it("进专注滚动 → 百分比跟着更新", () => {
    const el = mountScroller(0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MdFocusExitButton />));

    const readout = () =>
      host.querySelector('[aria-label="阅读进度"]')?.textContent?.trim();
    expect(readout()).toBe("0%");

    act(() => scrollTo(el, 300));
    expect(readout()).toBe("50%");

    act(() => scrollTo(el, 600));
    expect(readout()).toBe("100%");

    act(() => root.unmount());
  });

  it("细进度宽度跟百分比一致", () => {
    const el = mountScroller(0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MdFocusExitButton />));

    act(() => scrollTo(el, 150));
    const fill = host.querySelector<HTMLElement>('[aria-hidden] > span[style]');
    expect(fill?.style.width).toBe("25%");

    act(() => root.unmount());
  });
});

describe("退出专注后的原顶栏进度条", () => {
  /** 外层容器没有 style，填充条才有 width。 */
  const fillOf = (host: HTMLElement) =>
    host.querySelector<HTMLElement>("div > div[style]");

  it("非专注仍按同一份百分比渲染 2px 条", () => {
    const el = mountScroller(0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ReadingProgress />));

    act(() => scrollTo(el, 300));
    expect(fillOf(host)?.style.width).toBe("50%");

    act(() => root.unmount());
  });

  it("HTML 文档仍读 bridge 的 htmlScrollPercent", () => {
    focusType = "html";
    htmlScrollPercent = 42;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ReadingProgress />));

    expect(fillOf(host)?.style.width).toBe("42%");

    act(() => root.unmount());
  });
});
