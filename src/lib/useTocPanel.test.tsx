// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  closeTocPanel,
  getTocPanelState,
  isTocPanelOpen,
  requestToggleToc,
  setTocPanelOpen,
  useTocPanel,
} from "./tocPanel";

const setStatus = vi.fn();

vi.mock("@/lib/store", () => ({
  useStore: (sel: (s: { setStatus: typeof setStatus }) => unknown) =>
    sel({ setStatus }),
}));

/**
 * 最小宿主：只暴露按钮、开关和当前共享状态，不渲染真的 TocPopover。
 * TopBar 与专注浮动条都用这一个 hook，行为在这里钉一次就够。
 */
function Harness({
  docId,
  available,
}: {
  docId: string;
  available: boolean;
}) {
  const toc = useTocPanel({ docId, available });
  return (
    <div>
      <button aria-label="目录" onClick={toc.toggle}>
        目录
      </button>
      <button aria-label="强制开" onClick={() => toc.setOpen(true)}>
        开
      </button>
      <span data-open={toc.open ? "1" : "0"} />
    </div>
  );
}

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    rerender: (next: React.ReactNode) => act(() => root.render(next)),
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const isOpenInDom = (host: HTMLElement) =>
  host.querySelector("[data-open]")?.getAttribute("data-open") === "1";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  closeTocPanel();
  setStatus.mockReset();
});

describe("useTocPanel（TopBar 与专注浮动条共用）", () => {
  it("快捷键可以开、也可以关（同一条总线）", () => {
    const { host, cleanup } = mount(<Harness docId="d1" available />);
    expect(isOpenInDom(host)).toBe(false);

    act(() => requestToggleToc());
    expect(isOpenInDom(host)).toBe(true);
    expect(isTocPanelOpen()).toBe(true);
    expect(getTocPanelState().docId).toBe("d1");

    act(() => requestToggleToc());
    expect(isOpenInDom(host)).toBe(false);
    expect(isTocPanelOpen()).toBe(false);
    cleanup();
  });

  it("没有大纲时不开，并给出提示（快捷键不静默失败）", () => {
    const { host, cleanup } = mount(<Harness docId="d1" available={false} />);
    act(() => requestToggleToc());
    expect(isOpenInDom(host)).toBe(false);
    expect(isTocPanelOpen()).toBe(false);
    expect(setStatus).toHaveBeenCalledWith("这篇还没有大纲，加几个标题就能跳转");
    cleanup();
  });

  it("点外部与 Esc 都会收起，但不动别的状态", () => {
    const { cleanup } = mount(<Harness docId="d1" available />);
    act(() => requestToggleToc());
    expect(isTocPanelOpen()).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(isTocPanelOpen()).toBe(false);

    act(() => requestToggleToc());
    expect(isTocPanelOpen()).toBe(true);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(isTocPanelOpen()).toBe(false);
    cleanup();
  });

  it("换文档会收起浮层", () => {
    const { cleanup, rerender } = mount(<Harness docId="d1" available />);
    act(() => requestToggleToc());
    expect(isTocPanelOpen()).toBe(true);

    rerender(<Harness docId="d2" available />);
    expect(isTocPanelOpen()).toBe(false);
    cleanup();
  });

  it("两个宿主挂载时读同一份 open：一个开，另一个也看到开", () => {
    const { host, cleanup } = mount(
      <>
        <Harness docId="d1" available />
        <Harness docId="d1" available />
      </>
    );
    act(() => requestToggleToc());
    // 两个宿主各订阅一次总线：一次请求只应由「当前挂载的那个」翻转。
    // 这里用共享状态直接验证——它们看到的是同一个值，而不是各自一份。
    const seen = [...host.querySelectorAll("[data-open]")];
    expect(seen.every((el) => el.getAttribute("data-open") === "1")).toBe(true);
    cleanup();
  });

  it("外部直接改共享状态，宿主立刻跟上（不需要 DOM 探测）", () => {
    const { host, cleanup } = mount(<Harness docId="d1" available />);
    act(() => setTocPanelOpen(true, "d1"));
    expect(isOpenInDom(host)).toBe(true);
    cleanup();
  });
});
