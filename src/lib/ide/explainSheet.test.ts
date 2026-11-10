import { describe, expect, it } from "vitest";
import {
  explainSheetHasScrim,
  explainSheetHeightStyle,
  explainSheetToggleLabel,
  nextExplainSheetAfterJump,
  toggleExplainSheet,
} from "./explainSheet";

describe("explain sheet（窄屏讲解抽屉）", () => {
  it("半高默认留出编辑器上半段，加高档才更高", () => {
    expect(explainSheetHeightStyle("half").height).toBe("min(62dvh, 100dvh)");
    expect(explainSheetHeightStyle("full").height).toBe("min(100dvh, 100dvh)");
  });

  it("只有加高档铺遮罩，半高时顶栏 Tab 可点", () => {
    expect(explainSheetHasScrim("half")).toBe(false);
    expect(explainSheetHasScrim("full")).toBe(true);
  });

  it("抓手在半高 / 加高之间切换并给出对应文案", () => {
    expect(toggleExplainSheet("half")).toBe("full");
    expect(toggleExplainSheet("full")).toBe("half");
    expect(explainSheetToggleLabel("half")).toBe("加高讲解");
    expect(explainSheetToggleLabel("full")).toBe("收起讲解");
  });

  it("引用跳转成功时只把加高档收成半高", () => {
    expect(nextExplainSheetAfterJump(true, "full", true)).toBe("half");
    expect(nextExplainSheetAfterJump(true, "half", true)).toBe("half");
    // 跳转失败不动：保持用户刚拉的高度。
    expect(nextExplainSheetAfterJump(true, "full", false)).toBe("full");
    // 宽屏不参与。
    expect(nextExplainSheetAfterJump(false, "full", true)).toBe("full");
  });

  it("键盘弹起时整块抬到键盘上方，并限制不超过可见高度", () => {
    expect(explainSheetHeightStyle("half", 0)).toEqual({ height: "min(62dvh, 100dvh)" });
    expect(explainSheetHeightStyle("half")).toEqual({ height: "min(62dvh, 100dvh)" });
    expect(explainSheetHeightStyle("half", 280)).toEqual({
      height: "min(62dvh, calc(100dvh - 280px))",
      bottom: "280px",
    });
    expect(explainSheetHeightStyle("full", 320)).toEqual({
      height: "min(100dvh, calc(100dvh - 320px))",
      bottom: "320px",
    });
    expect(explainSheetHeightStyle("half", -10).bottom).toBeUndefined();
  });
});
