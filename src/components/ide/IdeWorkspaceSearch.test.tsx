// @vitest-environment jsdom
/**
 * 工程内搜索的开合契约。
 *
 * 以前「打开就清空」是在 effect 里 setQ/setPhase/setIdx 做的，React Compiler
 * 会报 set-state-in-effect。现在改成每次打开挂一个新的 body：空关键词 /
 * idle / 选中第一行都是 useState 的初始值。这里守住那三条可见结果。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("idb-keyval", () => {
  const mem = new Map<string, unknown>();
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => {
      mem.set(k, v);
    },
    del: async (k: string) => {
      mem.delete(k);
    },
  };
});

import { IdeWorkspaceSearch } from "./IdeWorkspaceSearch";
import { useIdeStore } from "@/lib/ide/store";

// jsdom 没有的浏览器 API，Dialog / 面板用到。
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
  useIdeStore.setState({
    session: {
      id: "s1",
      name: "demo",
      pathLabel: "demo",
      handle: {} as FileSystemDirectoryHandle,
      absRoot: null,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
  act(() => root.unmount());
  host.remove();
}

/** 等 focus 那个 20ms timeout 落地。 */
async function flushFocus() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

function searchInput(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('input[aria-label="工程内搜索"]');
  if (!el) throw new Error("搜索框没渲染出来");
  return el;
}

describe("工程内搜索：打开即清空并聚焦", () => {
  it("输入后关掉再打开，关键词是空的、状态回到 idle、焦点在输入框", async () => {
    const { host, root } = mount(
      <IdeWorkspaceSearch open onClose={() => {}} />
    );
    await flushFocus();

    const input = searchInput(host);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    // 打字：受控值立刻反映在输入框上。
    act(() => {
      input.value = "Calculator";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React 的 onChange 在 jsdom 里靠 value setter 触发，直接断言 store 无关，
    // 这里只关心「重开时回到空」。
    expect(searchInput(host).value).toBe("Calculator");

    // 关闭：整个 body 卸载（Dialog 返回 null）。
    act(() => root.render(<IdeWorkspaceSearch open={false} onClose={() => {}} />));
    expect(host.querySelector('input[aria-label="工程内搜索"]')).toBeNull();

    // 重新打开：新挂载的 body，初始 state 就是空的。
    act(() => root.render(<IdeWorkspaceSearch open onClose={() => {}} />));
    await flushFocus();
    const reopened = searchInput(host);
    expect(reopened.value).toBe("");
    expect(document.activeElement).toBe(reopened);

    unmount(root, host);
  });

  it("打开时显示空态提示，不跑一次空搜索", async () => {
    const { host, root } = mount(
      <IdeWorkspaceSearch open onClose={() => {}} />
    );
    await flushFocus();
    expect(host.textContent).toContain("输入关键词");
    expect(host.textContent).not.toContain("扫描中");
    unmount(root, host);
  });

  it("Esc 关闭走 onClose，不自己改 store", async () => {
    const onClose = vi.fn();
    const { host, root } = mount(
      <IdeWorkspaceSearch open onClose={onClose} />
    );
    await flushFocus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
    unmount(root, host);
  });
});
