import { describe, expect, it } from "vitest";
import { isBareModL, isIdeExplainToggleHotkey } from "./explainHotkey";

describe("explain hotkey", () => {
  it("toggles on Mod+Shift+L", () => {
    expect(
      isIdeExplainToggleHotkey({
        key: "L",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      })
    ).toBe(true);
    expect(
      isIdeExplainToggleHotkey({
        key: "l",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe(true);
  });

  it("does not toggle on bare Mod+L (address bar)", () => {
    expect(
      isIdeExplainToggleHotkey({
        key: "l",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
      })
    ).toBe(false);
    expect(
      isBareModL({
        key: "l",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
      })
    ).toBe(true);
  });
});
