import { describe, expect, it } from "vitest";
import {
  nextActiveAfterClose,
  tabCloseActionDisabled,
  tabsToClose,
} from "./tabClose";

const tabs = ["a", "b", "c", "d", "e"];

describe("tabsToClose", () => {
  it("self returns target", () => {
    expect(tabsToClose(tabs, [], "c", "self")).toEqual(["c"]);
  });

  it("left/right relative to target, skips pinned", () => {
    expect(tabsToClose(tabs, ["a"], "c", "left")).toEqual(["b"]);
    expect(tabsToClose(tabs, ["d"], "c", "right")).toEqual(["e"]);
  });

  it("others skips target and pinned", () => {
    expect(tabsToClose(tabs, ["b"], "c", "others")).toEqual(["a", "d", "e"]);
  });

  it("all skips pinned only", () => {
    expect(tabsToClose(tabs, ["c", "e"], "a", "all")).toEqual(["a", "b", "d"]);
  });

  it("leftmost/rightmost yield empty", () => {
    expect(tabsToClose(tabs, [], "a", "left")).toEqual([]);
    expect(tabsToClose(tabs, [], "e", "right")).toEqual([]);
  });
});

describe("tabCloseActionDisabled", () => {
  it("disables self when pinned", () => {
    expect(tabCloseActionDisabled(tabs, ["c"], "c", "self")).toBe(true);
    expect(tabCloseActionDisabled(tabs, [], "c", "self")).toBe(false);
  });

  it("disables left on leftmost and right on rightmost", () => {
    expect(tabCloseActionDisabled(tabs, [], "a", "left")).toBe(true);
    expect(tabCloseActionDisabled(tabs, [], "e", "right")).toBe(true);
    expect(tabCloseActionDisabled(tabs, [], "c", "left")).toBe(false);
  });

  it("disables others/all when only pinned remain closable", () => {
    expect(tabCloseActionDisabled(["a", "b"], ["a", "b"], "a", "others")).toBe(true);
    // target a; only other is pinned b → nothing to close
    expect(tabCloseActionDisabled(["a", "b"], ["b"], "a", "others")).toBe(true);
    // target b pinned; unpinned a is closable via others
    expect(tabCloseActionDisabled(["a", "b"], ["b"], "b", "others")).toBe(false);
  });
});

describe("nextActiveAfterClose", () => {
  it("keeps active if not closed", () => {
    expect(nextActiveAfterClose(tabs, "c", new Set(["a", "b"]))).toBe("c");
  });

  it("picks neighbor when active closed", () => {
    expect(nextActiveAfterClose(tabs, "c", new Set(["c"]))).toBe("d");
    expect(nextActiveAfterClose(tabs, "e", new Set(["e"]))).toBe("d");
  });

  it("returns null when all closed", () => {
    expect(nextActiveAfterClose(tabs, "a", new Set(tabs))).toBeNull();
  });
});
