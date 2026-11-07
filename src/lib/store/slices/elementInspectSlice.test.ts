import { describe, expect, it } from "vitest";
import { shouldInspectClick, shouldOpenElementPanel } from "./elementInspectSlice";
import type { BehaviorResolution } from "../../locate/jsIndex";

const empty: BehaviorResolution = {
  hits: [],
  delegated: [],
  queries: [],
  unresolved: 0,
  problems: [],
  hint: "",
};

describe("元素面板何时弹出", () => {
  it("有样式命中 → 开", () => {
    expect(shouldOpenElementPanel(1, empty)).toBe(true);
  });

  it("有行为命中 → 开（没样式也要说谁绑了 click）", () => {
    expect(
      shouldOpenElementPanel(0, { ...empty, hits: [{}, {}] as BehaviorResolution["hits"] })
    ).toBe(true);
  });

  it("只有相关查询 → 开（空态要回答「找到了查询，但没找到绑定」）", () => {
    expect(
      shouldOpenElementPanel(0, { ...empty, queries: [{}] as BehaviorResolution["queries"] })
    ).toBe(true);
  });

  it("三样全无 → 不开（点空白不该冒空面板）", () => {
    expect(shouldOpenElementPanel(0, empty)).toBe(false);
  });

  it("检视关着时普通点击不查，Alt+点击仍查", () => {
    expect(shouldInspectClick(false, false)).toBe(false);
    expect(shouldInspectClick(false, true)).toBe(true);
    expect(shouldInspectClick(true, false)).toBe(true);
  });

  it("只有页面级监听 / 无法归属 → 不开（否则每点一下都弹）", () => {
    expect(
      shouldOpenElementPanel(0, {
        ...empty,
        delegated: [{}] as BehaviorResolution["delegated"],
        unresolved: 3,
      })
    ).toBe(false);
  });
});
