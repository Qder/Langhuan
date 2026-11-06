import { describe, expect, it } from "vitest";
import {
  TYPEWRITER_ANCHOR_RATIO,
  TYPEWRITER_MIN_DELTA_PX,
  centeredScrollTop,
  shouldRecenter,
  typewriterBottomPad,
} from "./typewriter";

describe("centeredScrollTop", () => {
  it("把目标行摆到视口 45% 处", () => {
    // 视口 800，行在内容 2000 处 → 2000 - 800*0.45 = 1640
    expect(centeredScrollTop(2000, 800, 10000)).toBe(1640);
  });

  it("文档开头不会滚成负数", () => {
    expect(centeredScrollTop(10, 800, 10000)).toBe(0);
    expect(centeredScrollTop(0, 800, 10000)).toBe(0);
  });

  it("文档末尾不会超过最大滚动位置", () => {
    // max = 10000 - 800 = 9200；2000-360 远小于它，这里用靠后的坐标验证夹紧。
    expect(centeredScrollTop(9900, 800, 10000)).toBe(9200);
  });

  it("内容比视口矮时只能停在 0", () => {
    expect(centeredScrollTop(500, 800, 600)).toBe(0);
  });

  it("非有限输入不会算出 NaN", () => {
    expect(centeredScrollTop(NaN, 800, 10000)).toBe(0);
    expect(centeredScrollTop(2000, NaN, 10000)).toBe(0);
    expect(centeredScrollTop(2000, 800, NaN)).toBe(0);
  });

  it("ratio 会被夹到 [0,1]，坏值退回默认", () => {
    expect(centeredScrollTop(2000, 800, 10000, 2)).toBe(1200);
    expect(centeredScrollTop(2000, 800, 10000, -1)).toBe(2000);
    expect(centeredScrollTop(2000, 800, 10000, NaN)).toBe(2000 - 800 * TYPEWRITER_ANCHOR_RATIO);
  });

  it("默认锚点在中线略偏上", () => {
    expect(TYPEWRITER_ANCHOR_RATIO).toBeGreaterThan(0);
    expect(TYPEWRITER_ANCHOR_RATIO).toBeLessThan(0.5);
  });
});

describe("shouldRecenter", () => {
  it("小于阈值不滚，避免逐键亚像素抖动", () => {
    expect(shouldRecenter(100, 101)).toBe(false);
    expect(shouldRecenter(100, 100 + TYPEWRITER_MIN_DELTA_PX)).toBe(false);
    expect(shouldRecenter(100, 103)).toBe(true);
  });

  it("反向滚动同样按绝对位移判断", () => {
    expect(shouldRecenter(100, 97)).toBe(true);
    expect(shouldRecenter(100, 99)).toBe(false);
  });

  it("非有限输入一律不滚", () => {
    expect(shouldRecenter(NaN, 100)).toBe(false);
    expect(shouldRecenter(100, NaN)).toBe(false);
  });
});

describe("typewriterBottomPad", () => {
  it("半屏留白，对齐到 8px", () => {
    expect(typewriterBottomPad(800)).toBe(400);
    // 900/2 = 450 → 向上对齐到 456
    expect(typewriterBottomPad(900) % 8).toBe(0);
    expect(typewriterBottomPad(900)).toBeGreaterThan(400);
  });

  it("永远不小于默认的 40vh（打开开关只会把文末拉长，不会变短）", () => {
    for (const h of [320, 480, 800, 1200]) {
      expect(typewriterBottomPad(h)).toBeGreaterThanOrEqual(Math.floor(h * 0.4));
    }
  });

  it("异常高度返回 0，不往正文里塞莫名其妙的空白", () => {
    expect(typewriterBottomPad(0)).toBe(0);
    expect(typewriterBottomPad(-100)).toBe(0);
    expect(typewriterBottomPad(NaN)).toBe(0);
  });

  it("极矮视口也至少给一行", () => {
    expect(typewriterBottomPad(1)).toBeGreaterThanOrEqual(8);
  });
});
