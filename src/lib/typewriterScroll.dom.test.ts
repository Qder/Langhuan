// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  applyTypewriterBottomPad,
  centerTextareaCaret,
  estimateTextareaCaretY,
  scrollElementToTypewriterAnchor,
} from "./typewriterScroll";

/**
 * jsdom 不做排版，`getBoundingClientRect` 恒为 0，
 * 所以这里用显式矩形/度量伪造元素，只验算我们的算术与「该不该滚」的分支。
 */
function fakeScroller(opts: {
  scrollTop?: number;
  clientHeight: number;
  scrollHeight: number;
  top?: number;
}) {
  const el = {
    scrollTop: opts.scrollTop ?? 0,
    clientHeight: opts.clientHeight,
    scrollHeight: opts.scrollHeight,
    getBoundingClientRect: () => ({ top: opts.top ?? 0, left: 0 }) as DOMRect,
  };
  return el as unknown as HTMLElement;
}

function fakeTarget(top: number) {
  return {
    getBoundingClientRect: () => ({ top, left: 0 }) as DOMRect,
  } as unknown as HTMLElement;
}

describe("scrollElementToTypewriterAnchor", () => {
  it("把目标元素滚到视口 45% 处", () => {
    // 容器顶 0，宽高 800；目标当前在 2000 → contentY 2000（scrollTop 0）
    const scroller = fakeScroller({ clientHeight: 800, scrollHeight: 10000 });
    const ok = scrollElementToTypewriterAnchor(scroller, fakeTarget(2000));
    expect(ok).toBe(true);
    expect(Math.round(scroller.scrollTop)).toBe(1640);
  });

  it("已经在锚点附近时不动，避免每次按键都抖一下", () => {
    const scroller = fakeScroller({
      scrollTop: 1640,
      clientHeight: 800,
      scrollHeight: 10000,
    });
    // 目标在 viewport 顶 360 → contentY = 360 + 1640 = 2000，正好是锚点
    const ok = scrollElementToTypewriterAnchor(scroller, fakeTarget(360));
    expect(ok).toBe(false);
    expect(scroller.scrollTop).toBe(1640);
  });

  it("开头/结尾都夹在可滚范围内", () => {
    const top = fakeScroller({ clientHeight: 800, scrollHeight: 10000 });
    scrollElementToTypewriterAnchor(top, fakeTarget(10));
    expect(top.scrollTop).toBe(0);

    const bottom = fakeScroller({ scrollTop: 9000, clientHeight: 800, scrollHeight: 10000 });
    // 目标在视口顶 200 → contentY 9200 → 期望 9200-360=8840 反向滚动
    scrollElementToTypewriterAnchor(bottom, fakeTarget(200));
    expect(bottom.scrollTop).toBe(8840);
  });

  it("容器或目标缺失时安全返回 false", () => {
    expect(scrollElementToTypewriterAnchor(null, fakeTarget(0))).toBe(false);
    expect(
      scrollElementToTypewriterAnchor(
        fakeScroller({ clientHeight: 800, scrollHeight: 10000 }),
        null
      )
    ).toBe(false);
  });
});

describe("estimateTextareaCaretY", () => {
  function fakeTextarea(value: string) {
    return {
      value,
      // jsdom 的 getComputedStyle 对伪元素返回空串，这里直接 stub
      style: {},
    } as unknown as HTMLTextAreaElement;
  }

  it("按行号 × 行高估算内容坐标", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "24px",
      paddingTop: "8px",
      borderTopWidth: "1px",
    } as unknown as CSSStyleDeclaration);
    const ta = fakeTextarea("a\nb\nc");
    // 第 2 个 \n 之后 → lineIndex 2；8 + 1 + 2*24 = 57
    expect(estimateTextareaCaretY(ta, 4)).toBe(57);
  });

  it("行高解析不出来时返回 null，不瞎滚", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "normal",
      paddingTop: "8px",
      borderTopWidth: "0px",
    } as unknown as CSSStyleDeclaration);
    expect(estimateTextareaCaretY(fakeTextarea("a"), 0)).toBeNull();
  });

  it("光标越界时夹到正文长度，不产生 NaN", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      paddingTop: "0px",
      borderTopWidth: "0px",
    } as unknown as CSSStyleDeclaration);
    expect(estimateTextareaCaretY(fakeTextarea("a\nb"), 999)).toBe(20);
    expect(estimateTextareaCaretY(fakeTextarea("a\nb"), -5)).toBe(0);
  });
});

describe("centerTextareaCaret", () => {
  it("不可见（高度 0）时不动", () => {
    const ta = { clientHeight: 0, scrollTop: 0, scrollHeight: 500 } as unknown as HTMLTextAreaElement;
    expect(centerTextareaCaret(ta)).toBe(false);
    expect(ta.scrollTop).toBe(0);
  });

  it("缺少元素时安全返回 false", () => {
    expect(centerTextareaCaret(null)).toBe(false);
  });
});

describe("applyTypewriterBottomPad", () => {
  it("开启时写入半屏 padding，关闭时移除内联样式", () => {
    const el = fakeScroller({ clientHeight: 800, scrollHeight: 4000 }) as HTMLElement & {
      style: { paddingBottom: string; removeProperty: (k: string) => void };
    };
    const removed: string[] = [];
    el.style = {
      paddingBottom: "",
      removeProperty: (k: string) => {
        removed.push(k);
        el.style.paddingBottom = "";
      },
    } as never;

    applyTypewriterBottomPad(el, true);
    expect(el.style.paddingBottom).toBe("400px");

    applyTypewriterBottomPad(el, false);
    expect(removed).toContain("padding-bottom");
    expect(el.style.paddingBottom).toBe("");
  });

  it("元素缺失时不炸", () => {
    expect(() => applyTypewriterBottomPad(null, true)).not.toThrow();
  });
});
