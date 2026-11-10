// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExplainComposer } from "./ExplainComposer";
import type { SendExplain } from "./types";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

function mount(onSend: SendExplain, extra: Partial<React.ComponentProps<typeof ExplainComposer>> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ExplainComposer
        hasSession
        emptyHistory={false}
        busy={false}
        question="讲一下"
        includeFile
        includeSelection={false}
        includeNearby={false}
        includeFolder
        selectionActive={false}
        selectionRange={null}
        onQuestion={() => {}}
        onIncludeFile={() => {}}
        onIncludeSelection={() => {}}
        onIncludeNearby={() => {}}
        onIncludeFolder={() => {}}
        onSend={onSend}
        onStop={() => {}}
        onCaptureSelection={() => {}}
        {...extra}
      />
    );
  });
  const ta = host.querySelector("textarea");
  if (!ta) throw new Error("no textarea");
  return { host, root, ta };
}

function unmount(root: Root, host: HTMLElement) {
  act(() => root.unmount());
  host.remove();
}

function keydown(ta: HTMLTextAreaElement, init: KeyboardEventInit & { isComposing?: boolean; keyCode?: number }) {
  const { isComposing, keyCode, ...rest } = init;
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...rest });
  if (isComposing) {
    Object.defineProperty(ev, "isComposing", { get: () => true });
  }
  if (keyCode != null) {
    Object.defineProperty(ev, "keyCode", { get: () => keyCode });
  }
  ta.dispatchEvent(ev);
  return ev;
}

describe("ExplainComposer 键盘", () => {
  let root: Root;
  let host: HTMLElement;

  afterEach(() => {
    if (root && host) unmount(root, host);
  });

  it("Enter 发送", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend));
    const ta = host.querySelector("textarea")!;
    act(() => {
      keydown(ta, { key: "Enter" });
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter 不发送", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend));
    const ta = host.querySelector("textarea")!;
    act(() => {
      keydown(ta, { key: "Enter", shiftKey: true });
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("IME composing / keyCode 229 不发送", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend));
    const ta = host.querySelector("textarea")!;
    act(() => {
      keydown(ta, { key: "Enter", isComposing: true });
      keydown(ta, { key: "Enter", keyCode: 229 });
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("空内容或 busy 时 Enter 不发送", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend, { question: "   " }));
    act(() => {
      keydown(host.querySelector("textarea")!, { key: "Enter" });
    });
    expect(onSend).not.toHaveBeenCalled();
    unmount(root, host);
    ({ host, root } = mount(onSend, { busy: true, question: "讲一下" }));
    const ta = host.querySelector("textarea");
    // busy 时 textarea disabled，keydown 仍可能打到
    if (ta) {
      act(() => {
        keydown(ta, { key: "Enter" });
      });
    }
    expect(onSend).not.toHaveBeenCalled();
  });

  it("placeholder 写明 Enter 发送", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend));
    expect(host.querySelector("textarea")?.placeholder).toContain("Enter 发送 · Shift+Enter 换行");
  });
});

describe("ExplainComposer 当前选区", () => {
  let root: Root;
  let host: HTMLElement;

  afterEach(() => {
    if (root && host) unmount(root, host);
  });

  it("无选区时不可勾，并写明先在编辑器划词", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend, {
      includeSelection: true,
      selectionActive: false,
    }));
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    const sel = boxes.find((el) =>
      el.closest("label")?.textContent?.includes("当前选区")
    ) as HTMLInputElement | undefined;
    expect(sel).toBeTruthy();
    expect(sel!.disabled).toBe(true);
    expect(sel!.checked).toBe(false);
    expect(host.textContent).toContain("先在编辑器划词");
    expect(sel!.closest("label")?.getAttribute("title")).toBe("先在编辑器划词");
  });

  it("有选区时可勾", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend, {
      includeSelection: true,
      selectionActive: true,
      selectionRange: { path: "A.java", fromLine: 1, toLine: 3 },
    }));
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    const sel = boxes.find((el) =>
      el.closest("label")?.textContent?.includes("当前选区")
    ) as HTMLInputElement | undefined;
    expect(sel!.disabled).toBe(false);
    expect(sel!.checked).toBe(true);
    expect(host.textContent).not.toContain("先在编辑器划词");
  });
});

describe("ExplainComposer 工程文件", () => {
  let root: Root;
  let host: HTMLElement;

  afterEach(() => {
    if (root && host) unmount(root, host);
  });

  it("有带上工程文件勾选项，默认勾上", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend));
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]'));
    const folder = boxes.find((el) =>
      el.closest("label")?.textContent?.includes("带上工程文件")
    ) as HTMLInputElement | undefined;
    expect(folder).toBeTruthy();
    expect(folder!.checked).toBe(true);
    expect(host.querySelector("textarea")?.placeholder).toContain("问这个工程");
  });
});

describe("ExplainComposer 软键盘收起次要说明", () => {
  let root: Root;
  let host: HTMLElement;

  afterEach(() => {
    if (root && host) unmount(root, host);
  });

  it("键盘弹起时隐藏预设芯片和旁注，输入框和发送仍在", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend, { emptyHistory: true, keyboardInset: 280 }));
    expect(host.textContent).not.toContain("这个工程在干什么");
    expect(host.querySelector('[aria-label="待发送上下文"]')).toBeNull();
    expect(host.querySelector("textarea")).toBeTruthy();
    expect(host.querySelector('[aria-label="发送"]')).toBeTruthy();
  });

  it("没有键盘时仍显示预设和上下文说明", () => {
    const onSend = vi.fn<SendExplain>();
    ({ host, root } = mount(onSend, { emptyHistory: true, keyboardInset: 0 }));
    expect(host.textContent).toContain("这个工程在干什么");
    expect(host.querySelector('[aria-label="待发送上下文"]')).toBeTruthy();
  });
});
