// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MdFocusExitButton } from "./MdFocusExitButton";
import { requestToggleToc } from "@/lib/tocPanel";

const setMdFocusMode = vi.fn();
const setStatus = vi.fn();

const doc = {
  id: "doc_1",
  type: "md" as const,
  path: "笔记/离散数学/集合.md",
  title: "集合",
  content: "# 集合\n\n## 定义\n\n## 运算\n",
  updatedAt: 0,
  createdAt: 0,
};

const store = {
  setMdFocusMode,
  setStatus,
  getActive: () => doc,
  documents: [doc],
  getContent: () => "# 集合\n\n## 定义\n\n## 运算\n",
  annotations: [],
  assetsForDoc: () => [],
  // DocAside（浮层内部）读到的其余 store 字段，测试里不需要真的动作。
  requestOpenDoc: vi.fn(),
  setDraft: vi.fn(),
  saveDoc: vi.fn(),
  updateAnnotation: vi.fn(),
  removeAnnotation: vi.fn(),
  applyLocateResult: vi.fn(),
  requestPreviewLocate: vi.fn(),
};

vi.mock("@/lib/store", () => ({
  useStore: (sel: (s: typeof store) => unknown) => sel(store),
}));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  setMdFocusMode.mockReset();
  setStatus.mockReset();
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MdFocusExitButton />);
  });
  return {
    host,
    root,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const byLabel = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  ) as HTMLButtonElement | undefined;

describe("MdFocusExitButton（专注浮动条）", () => {
  it("没有顶栏时也给出可见的「目录」和「退出」", () => {
    const { host, cleanup } = mount();
    expect(byLabel(host, "目录")?.textContent).toContain("目录");
    expect(byLabel(host, "退出专注")?.textContent).toContain("退出");
    cleanup();
  });

  it("点「目录」打开大纲浮层，点了标题会自动收起", () => {
    const { host, cleanup } = mount();
    act(() => {
      byLabel(host, "目录")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const panel = document.querySelector("[data-toc-popover]");
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("定义");

    const heading = [...panel!.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("定义")
    );
    expect(heading).toBeTruthy();
    act(() => {
      heading!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-toc-popover]")).toBeNull();
    // 跳标题不该顺手退出专注。
    expect(setMdFocusMode).not.toHaveBeenCalled();
    cleanup();
  });

  it("「退出」关掉专注并收起浮层", () => {
    const { host, cleanup } = mount();
    act(() => {
      byLabel(host, "目录")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-toc-popover]")).toBeTruthy();
    act(() => {
      byLabel(host, "退出专注")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setMdFocusMode).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith("已退出专注模式");
    cleanup();
  });

  it("快捷键请求能切换目录（非专注入口共用同一条总线）", () => {
    const { cleanup } = mount();
    act(() => {
      requestToggleToc();
    });
    expect(document.querySelector("[data-toc-popover]")).toBeTruthy();
    act(() => {
      requestToggleToc();
    });
    expect(document.querySelector("[data-toc-popover]")).toBeNull();
    cleanup();
  });

  it("Esc 只关目录，不退出专注", () => {
    const { cleanup } = mount();
    act(() => {
      requestToggleToc();
    });
    expect(document.querySelector("[data-toc-popover]")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-toc-popover]")).toBeNull();
    expect(setMdFocusMode).not.toHaveBeenCalled();
    cleanup();
  });
});
