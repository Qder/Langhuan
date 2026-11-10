import { describe, expect, it } from "vitest";
import { KEYBOARD_INSET_IGNORE_BELOW_PX, keyboardInsetPx } from "./keyboardInset";
import { explainDockKeyboardPadding } from "./ide/explainKeyboardStyle";

describe("keyboardInsetPx", () => {
  it("没有 visualViewport 时不虚构遮挡", () => {
    expect(keyboardInsetPx(null, 800)).toBe(0);
    expect(keyboardInsetPx(undefined, 800)).toBe(0);
  });

  it("键盘弹起后按底部遮挡像素计算", () => {
    // 布局 800，可见 500，offsetTop 0 → 底部被挡 300。
    expect(keyboardInsetPx({ height: 500, offsetTop: 0 }, 800)).toBe(300);
  });

  it("iOS 上滚 visualViewport 时仍只算底部遮挡", () => {
    // 布局 800，可见 500，被向上推了 80 → 底部 800-580=220。
    expect(keyboardInsetPx({ height: 500, offsetTop: 80 }, 800)).toBe(220);
  });

  it("地址栏之类的小幅收缩忽略", () => {
    const almost = KEYBOARD_INSET_IGNORE_BELOW_PX - 1;
    expect(keyboardInsetPx({ height: 800 - almost, offsetTop: 0 }, 800)).toBe(0);
    expect(keyboardInsetPx({ height: 800 - KEYBOARD_INSET_IGNORE_BELOW_PX, offsetTop: 0 }, 800)).toBe(0);
    expect(
      keyboardInsetPx({ height: 800 - (KEYBOARD_INSET_IGNORE_BELOW_PX + 1), offsetTop: 0 }, 800)
    ).toBe(KEYBOARD_INSET_IGNORE_BELOW_PX + 1);
  });

  it("坏数字不当成键盘", () => {
    expect(keyboardInsetPx({ height: Number.NaN, offsetTop: 0 }, 800)).toBe(0);
    expect(keyboardInsetPx({ height: 500, offsetTop: 0 }, Number.NaN)).toBe(0);
    expect(keyboardInsetPx({ height: 0, offsetTop: 0 }, 800)).toBe(0);
    expect(keyboardInsetPx({ height: 500, offsetTop: 0 }, 0)).toBe(0);
  });
});

describe("explainDockKeyboardPadding", () => {
  it("只在停靠且有键盘时垫高，并计入安全区", () => {
    expect(explainDockKeyboardPadding(false, 280)).toBeUndefined();
    expect(explainDockKeyboardPadding(true, 0)).toBeUndefined();
    expect(explainDockKeyboardPadding(true, 280)).toBe("max(280px, env(safe-area-inset-bottom))");
  });
});
