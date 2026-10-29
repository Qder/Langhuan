import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  matchShortcut,
  normalizeShortcuts,
} from "./shortcuts";

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: !!partial.metaKey,
    ctrlKey: !!partial.ctrlKey,
    altKey: !!partial.altKey,
    shiftKey: !!partial.shiftKey,
    code: partial.code || "",
  } as KeyboardEvent;
}

describe("shortcuts", () => {
  it("normalize merges defaults", () => {
    const m = normalizeShortcuts({ save: "mod+shift+s" });
    expect(m.save).toBe("mod+shift+s");
    expect(m.commandPalette).toBe(DEFAULT_SHORTCUTS.commandPalette);
  });

  it("matchShortcut mod+k", () => {
    expect(
      matchShortcut(keyEvent({ key: "k", metaKey: true }), "mod+k")
    ).toBe(true);
    expect(
      matchShortcut(keyEvent({ key: "k", ctrlKey: true }), "mod+k")
    ).toBe(true);
    expect(matchShortcut(keyEvent({ key: "k" }), "mod+k")).toBe(false);
  });

  it("matchShortcut bare f without mod", () => {
    expect(matchShortcut(keyEvent({ key: "f" }), "f")).toBe(true);
    expect(matchShortcut(keyEvent({ key: "f", metaKey: true }), "f")).toBe(false);
  });

  it("formatShortcut includes glyph or Ctrl", () => {
    const s = formatShortcut("mod+s");
    expect(s === "⌘S" || s === "Ctrl+S").toBe(true);
  });

  it("matchShortcut preview undo/redo", () => {
    expect(
      matchShortcut(keyEvent({ key: "z", metaKey: true }), DEFAULT_SHORTCUTS.previewUndo)
    ).toBe(true);
    expect(
      matchShortcut(
        keyEvent({ key: "z", metaKey: true, shiftKey: true }),
        DEFAULT_SHORTCUTS.previewUndo
      )
    ).toBe(false);
    expect(
      matchShortcut(
        keyEvent({ key: "z", metaKey: true, shiftKey: true }),
        DEFAULT_SHORTCUTS.previewRedo
      )
    ).toBe(true);
  });
});
