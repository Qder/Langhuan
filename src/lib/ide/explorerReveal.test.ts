import { describe, expect, it } from "vitest";
import {
  EXPLORER_REVEAL_GIVE_UP_MS,
  EXPLORER_REVEAL_HIGHLIGHT_MS,
  explorerRevealStillWaiting,
  explorerRowSelector,
} from "./explorerReveal";
import { ideAncestorDirs } from "./citations";

describe("explorerReveal", () => {
  it("highlight lasts ~1.5s and give-up ~2s", () => {
    expect(EXPLORER_REVEAL_HIGHLIGHT_MS).toBe(1500);
    expect(EXPLORER_REVEAL_GIVE_UP_MS).toBe(2000);
  });

  it("stops waiting once the row is found", () => {
    expect(explorerRevealStillWaiting(0, 100, true)).toBe(false);
  });

  it("keeps waiting before give-up when row missing", () => {
    expect(explorerRevealStillWaiting(0, 500, false)).toBe(true);
    expect(explorerRevealStillWaiting(0, EXPLORER_REVEAL_GIVE_UP_MS, false)).toBe(
      false
    );
  });

  it("deep chip path expands src/a/b ancestors", () => {
    expect(ideAncestorDirs("src/a/b/Foo.java")).toEqual([
      "src",
      "src/a",
      "src/a/b",
    ]);
  });

  it("row selector stamps path attribute", () => {
    expect(explorerRowSelector("src/a/b/Foo.java")).toContain(
      'data-ide-path="src/a/b/Foo.java"'
    );
  });
});
