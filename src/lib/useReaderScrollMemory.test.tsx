// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// 这里只验证滚动的存取；`useReadingProgress` 顺带引入整棵 store，
// 在 jsdom 里会触发 IndexedDB/hydrate 的副作用，挡掉它。
vi.mock("@/lib/store", () => ({ useStore: () => undefined }));

import { useReaderScrollMemory } from "./useReaderScrollMemory";
import { MD_SCROLL_STORAGE_KEY, readScrollMemory } from "./scrollMemory";
import { READER_SCROLL_ID } from "./useReadingProgress";

const KEY = MD_SCROLL_STORAGE_KEY;

let root: Root | null = null;
let host: HTMLElement | null = null;

type Geometry = { scrollHeight: number; clientHeight: number };

function mountScroller(geo: Geometry, scrollTop = 0) {
  const el = document.createElement("div");
  el.id = READER_SCROLL_ID;
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => geo.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => geo.clientHeight,
  });
  el.scrollTop = scrollTop;
  document.body.appendChild(el);
  return el;
}

function Reader({ path, enabled }: { path: string; enabled: boolean }) {
  useReaderScrollMemory({ path, enabled });
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

/** jsdom 的 rAF 需要被推一下才跑。 */
async function settle(frames = 4) {
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
  }
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
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

describe("useReaderScrollMemory", () => {
  it("节流保存：滚动后记的是 scrollTop 与比例", async () => {
    const el = mountScroller({ scrollHeight: 2000, clientHeight: 400 });
    await render(<Reader path="a.md" enabled />);

    scrollTo(el, 400); // 400 / 1600 = 25%
    await settle();

    const entry = readScrollMemory("a.md")!;
    expect(entry.top).toBe(400);
    expect(entry.ratio).toBeCloseTo(0.25, 5);
  });

  it("重挂载后按比例还原到同一篇的位置", async () => {
    const geo = { scrollHeight: 2000, clientHeight: 400 };
    let el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 800); // 50%
    await settle();
    await cleanup();

    // 模拟重开应用：新的 DOM、正文高度还一样。
    el = mountScroller(geo, 0);
    await render(<Reader path="a.md" enabled />);
    await settle(5);
    expect(el.scrollTop).toBe(800);
  });

  it("正文变高后按比例落点，而不是记死的像素", async () => {
    let geo = { scrollHeight: 2000, clientHeight: 400 };
    let el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 800); // 50% of max 1600
    await settle();
    await cleanup();

    // 图片加载完，正文撑到 4000：max 变成 3600，50% → 1800。
    geo = { scrollHeight: 4000, clientHeight: 400 };
    el = mountScroller(geo, 0);
    await render(<Reader path="a.md" enabled />);
    await settle(5);
    expect(el.scrollTop).toBe(1800);
  });

  it("换篇不串位置", async () => {
    const geo = { scrollHeight: 2000, clientHeight: 400 };
    const el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 600);
    await settle();

    // A 的进度落盘了；切到 B 时 B 没有记录，不许被 A 的位置带跑。
    el.scrollTop = 0;
    await rerender(<Reader path="b.md" enabled />);
    await settle(5);
    expect(el.scrollTop).toBe(0);
    expect(readScrollMemory("b.md")).toBeNull();
    expect(readScrollMemory("a.md")!.top).toBe(600);
  });

  it("换到更短的文档时先归零，不被浏览器 clamp 到新底部", async () => {
    const el = mountScroller({ scrollHeight: 3000, clientHeight: 400 });
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 2400); // A 滚到很下面
    await settle();

    // 共享的 #reader-scroll：B 只有 800 高，旧 scrollTop 会被 clamp 到 400。
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => 800,
    });
    el.scrollTop = 400;
    await rerender(<Reader path="b.md" enabled />);
    await settle(5);

    expect(el.scrollTop).toBe(0);
    expect(readScrollMemory("a.md")!.top).toBe(2400);
    expect(readScrollMemory("b.md")).toBeNull();
  });

  it("切篇时浏览器 clamp 出来的位置不会被记成新一篇的进度", async () => {
    const el = mountScroller({ scrollHeight: 3000, clientHeight: 400 });
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 2000);
    await settle();

    // 切到一篇更短的：DOM 先换成 B 的高度，浏览器把 scrollTop 夹到底。
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => 700,
    });
    el.scrollTop = 300;
    await rerender(<Reader path="b.md" enabled />);
    await settle(5);

    // 这个 300 是浏览器给的，不是用户读到的位置。
    expect(readScrollMemory("b.md")).toBeNull();
  });

  it("切走时用跟踪值保存，不会把上一篇的进度写到下一篇头上", async () => {
    const geo = { scrollHeight: 2000, clientHeight: 400 };
    const el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 1000); // A 的 62.5%
    await settle();

    // 切换瞬间 DOM 已经是 B 的正文（更高），但 A 的保存必须还是 A 的数字。
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => 9999,
    });
    el.scrollTop = 0;
    await rerender(<Reader path="b.md" enabled />);
    await settle();

    expect(readScrollMemory("a.md")!.top).toBe(1000);
    expect(readScrollMemory("a.md")!.ratio).toBeCloseTo(0.625, 5);
    expect(readScrollMemory("b.md")).toBeNull();
  });

  it("非预览模式既不存也不恢复", async () => {
    // 先存一篇的分割视图位置
    const geo = { scrollHeight: 2000, clientHeight: 400 };
    const el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 800);
    await settle();
    await cleanup();

    localStorage.clear();
    const el2 = mountScroller(geo, 0);
    await render(<Reader path="a.md" enabled={false} />);
    await settle(5);
    expect(el2.scrollTop).toBe(0);

    scrollTo(el2, 500);
    await settle();
    expect(readScrollMemory("a.md")).toBeNull();
  });

  it("面板隐藏（clientHeight 0）时不写坏数据", async () => {
    const el = mountScroller({ scrollHeight: 2000, clientHeight: 400 });
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 700);
    await settle();

    // split 里预览被隐藏：scrollHeight 还在，clientHeight 塌成 0。
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 0 });
    scrollTo(el, 0);
    await settle();
    expect(readScrollMemory("a.md")!.top).toBe(700);
  });

  it("比例记下的仍能还原，且清掉孤儿数据不报错", async () => {
    const el = mountScroller({ scrollHeight: 1000, clientHeight: 400 });
    localStorage.setItem(
      KEY,
      JSON.stringify({ "gone.md": { top: 1, ratio: 0.5, savedAt: 1 }, "a.md": 42 })
    );
    await render(<Reader path="a.md" enabled />);
    await settle(5);
    // a.md 的记录是坏的 → 静默忽略，不跳
    expect(el.scrollTop).toBe(0);
  });

  it("在 yieldTo 时不覆盖已有跳转", async () => {
    const el = mountScroller({ scrollHeight: 2000, clientHeight: 400 });
    localStorage.setItem(
      KEY,
      JSON.stringify({ "a.md": { top: 800, ratio: 0.5, savedAt: 1 } })
    );
    function Yielding({ yieldTo }: { yieldTo: boolean }) {
      useReaderScrollMemory({ path: "a.md", enabled: true, yieldTo });
      return null;
    }
    await render(<Yielding yieldTo />);
    await settle(5);
    // 让位给「定位到源码」，别把它顶回 800
    expect(el.scrollTop).toBe(0);
  });

  it("首帧高度为 0 时等布局撑开再恢复，不把 0 当结论", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ "a.md": { top: 800, ratio: 0.5, savedAt: 1 } })
    );
    const el = mountScroller({ scrollHeight: 2000, clientHeight: 0 }, 0);
    await render(<Reader path="a.md" enabled />);
    await settle(5);
    expect(el.scrollTop).toBe(0);

    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 250));
    });
    expect(el.scrollTop).toBe(800);
  });

  it("预览关掉再打开且位置被清零时，按记录恢复", async () => {
    const geo = { scrollHeight: 2000, clientHeight: 400 };
    const el = mountScroller(geo);
    await render(<Reader path="a.md" enabled />);
    scrollTo(el, 800);
    await settle();
    await rerender(<Reader path="a.md" enabled={false} />);
    el.scrollTop = 0;
    await rerender(<Reader path="a.md" enabled />);
    await settle(5);
    expect(el.scrollTop).toBe(800);
  });
});
