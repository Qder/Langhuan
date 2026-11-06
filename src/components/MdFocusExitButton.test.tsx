// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MdFocusExitButton } from "./MdFocusExitButton";
import { requestToggleToc, isTocPanelOpen, setTocPanelOpen } from "@/lib/tocPanel";

const setMdFocusMode = vi.fn();
const setStatus = vi.fn();
const setReadingPrefs = vi.fn();

const doc = {
  id: "doc_1",
  type: "md" as const,
  path: "笔记/离散数学/集合.md",
  title: "集合",
  content: "# 集合\n\n## 定义\n\n## 运算\n",
  updatedAt: 0,
  createdAt: 0,
};

const doc2 = {
  ...doc,
  id: "doc_2",
  path: "笔记/离散数学/关系.md",
  title: "关系",
  content: "# 关系\n\n## 定义\n",
};

/** 可变：换文档那条用例要真的让宿主看到另一篇。 */
let current: typeof doc = doc;

const store = {
  setMdFocusMode,
  setStatus,
  readingPrefs: { typewriterMode: false },
  setReadingPrefs,
  viewMode: "source" as const,
  getActive: () => current,
  documents: [doc, doc2],
  getContent: (id?: string) => (id === doc2.id ? doc2.content : doc.content),
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
  setReadingPrefs.mockReset();
  current = doc;
  setTocPanelOpen(false);
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

  // 专注模式会整块不渲染 TopBar，阅读弹层也跟着消失；
  // 浮条上的这个开关是专注时唯一的打字机入口，不能悄悄消失。
  it("源码模式下浮条给出打字机开关，点一下真的写偏好", () => {
    const { host, cleanup } = mount();
    const tw = byLabel(host, "打字机滚动");
    expect(tw).toBeTruthy();
    expect(tw?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      tw!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setReadingPrefs).toHaveBeenCalledWith({ typewriterMode: true });
    cleanup();
  });

  it("纯预览没有可跟随的编辑光标，不摆这个开关", () => {
    store.viewMode = "preview" as never;
    const { host, cleanup } = mount();
    expect(byLabel(host, "打字机滚动")).toBeUndefined();
    store.viewMode = "source" as never;
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

  it("「退出」关掉专注并收起浮层（不把浮层带到顶栏）", () => {
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
    expect(document.querySelector("[data-toc-popover]")).toBeNull();
    expect(isTocPanelOpen()).toBe(false);
    cleanup();
  });

  it("换文档会收起浮层（共享状态不跟着跑到新文档）", () => {
    const { host, root, cleanup } = mount();
    act(() => {
      byLabel(host, "目录")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-toc-popover]")).toBeTruthy();
    // 换成另一篇文档：hook 的 docId effect 收起浮层，而不是把它留在屏幕上。
    act(() => {
      current = doc2;
      root.render(<MdFocusExitButton />);
    });
    expect(document.querySelector("[data-toc-popover]")).toBeNull();
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
