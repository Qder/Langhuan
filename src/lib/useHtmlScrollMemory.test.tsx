// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHtmlScrollMemory } from "./useHtmlScrollMemory";
import {
  MD_SCROLL_STORAGE_KEY,
  readScrollMemoryPercent,
  writeScrollMemoryPercent,
} from "./scrollMemory";

const KEY = MD_SCROLL_STORAGE_KEY;

let root: Root | null = null;
let host: HTMLElement | null = null;

type Post = { type: "scrollToPercent"; percent: number };

function Harness({
  path,
  enabled,
  yieldTo,
  reloadKey,
  post,
  setPercent,
  apiRef,
}: {
  path: string;
  enabled: boolean;
  yieldTo?: boolean;
  reloadKey?: string;
  post: (msg: Post) => void;
  setPercent?: (n: number) => void;
  apiRef: React.MutableRefObject<{
    onBridgePercent: (n: number) => void;
    onIframeReady: (opts?: { yieldTo?: boolean }) => void;
  } | null>;
}) {
  const api = useHtmlScrollMemory({
    path,
    enabled,
    yieldTo,
    reloadKey,
    post,
    setPercent,
  });
  React.useEffect(() => {
    apiRef.current = api;
  });
  return null;
}

async function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

async function rerender(ui: React.ReactElement) {
  await act(async () => {
    root!.render(ui);
  });
}

async function cleanup() {
  await act(async () => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(async () => {
  await cleanup();
});

describe("useHtmlScrollMemory", () => {
  it("预览模式下把 bridge 百分比写入共用的 scrollMemory", async () => {
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    await act(async () => {
      apiRef.current!.onIframeReady();
    });
    await act(async () => {
      apiRef.current!.onBridgePercent(40);
    });
    expect(readScrollMemoryPercent("page.html")).toBeCloseTo(40, 5);
    expect(localStorage.getItem(KEY)).toContain("page.html");
  });

  it("源码/分栏模式不写记忆", async () => {
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled={false} post={post} apiRef={apiRef} />
    );
    await act(async () => {
      apiRef.current!.onIframeReady();
      apiRef.current!.onBridgePercent(40);
    });
    expect(readScrollMemoryPercent("page.html")).toBeNull();
  });

  it("iframe ready 后按记忆发出 scrollToPercent，载入时的 0 不覆盖记录", async () => {
    writeScrollMemoryPercent("page.html", 50);
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    await act(async () => {
      // 载入瞬间 bridge 会先报 0，必须在 ready/恢复前被忽略。
      apiRef.current!.onBridgePercent(0);
    });
    expect(readScrollMemoryPercent("page.html")).toBeCloseTo(50, 5);
    await act(async () => {
      apiRef.current!.onIframeReady();
    });
    expect(post).toHaveBeenCalledWith({ type: "scrollToPercent", percent: 50 });
    await act(async () => {
      apiRef.current!.onBridgePercent(50);
    });
    expect(readScrollMemoryPercent("page.html")).toBeCloseTo(50, 5);
  });

  it("yieldTo 时不发出恢复，跳转标志清掉后也不追回来", async () => {
    writeScrollMemoryPercent("page.html", 50);
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    function Yielding({ yieldTo }: { yieldTo: boolean }) {
      return (
        <Harness
          path="page.html"
          enabled
          yieldTo={yieldTo}
          post={post}
          apiRef={apiRef}
        />
      );
    }
    await render(<Yielding yieldTo />);
    await act(async () => {
      apiRef.current!.onIframeReady({ yieldTo: true });
    });
    expect(post).not.toHaveBeenCalled();
    await rerender(<Yielding yieldTo={false} />);
    expect(post).not.toHaveBeenCalled();
  });

  it("预览关掉再打开时按记录再发一次恢复", async () => {
    writeScrollMemoryPercent("page.html", 25);
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    await act(async () => {
      apiRef.current!.onIframeReady();
    });
    expect(post).toHaveBeenCalledTimes(1);
    await rerender(
      <Harness path="page.html" enabled={false} post={post} apiRef={apiRef} />
    );
    post.mockClear();
    await rerender(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    expect(post).toHaveBeenCalledWith({ type: "scrollToPercent", percent: 25 });
  });

  it("首帧还不能滚时会按节奏重试，不把 0 当结论", async () => {
    writeScrollMemoryPercent("page.html", 75);
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    await act(async () => {
      apiRef.current!.onIframeReady();
    });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 250));
    });
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(post).toHaveBeenCalledWith({ type: "scrollToPercent", percent: 75 });
  });

  it("恢复期间用户自己滚动则停止后续补发，并记下新位置", async () => {
    writeScrollMemoryPercent("page.html", 80);
    const post = vi.fn();
    const apiRef: React.MutableRefObject<{
      onBridgePercent: (n: number) => void;
      onIframeReady: (opts?: { yieldTo?: boolean }) => void;
    } | null> = { current: null };
    await render(
      <Harness path="page.html" enabled post={post} apiRef={apiRef} />
    );
    await act(async () => {
      apiRef.current!.onIframeReady();
    });
    const afterReady = post.mock.calls.length;
    await act(async () => {
      // 等 120ms 的 suppress 窗口过后再视为用户滚动
      await new Promise<void>((r) => setTimeout(r, 150));
    });
    await act(async () => {
      apiRef.current!.onBridgePercent(10);
    });
    expect(readScrollMemoryPercent("page.html")).toBeCloseTo(10, 5);
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 250));
    });
    expect(post.mock.calls.length).toBe(afterReady);
  });
});
