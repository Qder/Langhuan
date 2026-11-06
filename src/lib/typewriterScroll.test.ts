import { describe, expect, it } from "vitest";
import { readScrollHostMetrics } from "./typewriterScroll";

/** 造一个最小的假滚动容器，不依赖 jsdom 的布局（它没有真实排版）。 */
function fakeHost(metrics: Partial<{ scrollTop: number; clientHeight: number; scrollHeight: number }>) {
  return {
    scrollTop: metrics.scrollTop ?? 0,
    clientHeight: metrics.clientHeight ?? 0,
    scrollHeight: metrics.scrollHeight ?? 0,
  } as unknown as HTMLElement;
}

describe("readScrollHostMetrics", () => {
  it("读取可滚动容器的高度信息", () => {
    expect(
      readScrollHostMetrics(fakeHost({ scrollTop: 120, clientHeight: 600, scrollHeight: 4000 }))
    ).toEqual({ scrollTop: 120, clientHeight: 600, scrollHeight: 4000 });
  });

  it("没有高度（display:none / 未挂载）返回 null，调用方据此跳过", () => {
    expect(readScrollHostMetrics(fakeHost({ clientHeight: 0 }))).toBeNull();
    expect(readScrollHostMetrics(null)).toBeNull();
  });

  it("非有限值返回 null", () => {
    expect(
      readScrollHostMetrics(fakeHost({ clientHeight: NaN, scrollHeight: 4000 }))
    ).toBeNull();
  });
});
