import { describe, expect, it } from "vitest";
import {
  claimShortcut,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  isTypingTarget,
  matchShortcut,
  normalizeShortcuts,
  SHORTCUTS_ALLOWED_WHILE_TYPING,
  shortcutAllowedWhileTyping,
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

  it("search defaults to mod+f", () => {
    expect(DEFAULT_SHORTCUTS.search).toBe("mod+f");
    expect(
      matchShortcut(keyEvent({ key: "f", ctrlKey: true }), DEFAULT_SHORTCUTS.search)
    ).toBe(true);
  });

  it("search label is in-file find", async () => {
    const { SHORTCUT_LABELS } = await import("./shortcuts");
    expect(SHORTCUT_LABELS.search).toBe("文件内查找");
  });

  it("打字机滚动有默认快捷键和中文标签", async () => {
    const { SHORTCUT_LABELS } = await import("./shortcuts");
    expect(DEFAULT_SHORTCUTS.typewriterMode).toBe("mod+shift+t");
    expect(SHORTCUT_LABELS.typewriterMode).toBe("打字机滚动");
    expect(
      matchShortcut(
        keyEvent({ key: "t", ctrlKey: true, shiftKey: true }),
        DEFAULT_SHORTCUTS.typewriterMode
      )
    ).toBe(true);
    // 不带 shift 属于别的功能，不能误触。
    expect(
      matchShortcut(keyEvent({ key: "t", ctrlKey: true }), DEFAULT_SHORTCUTS.typewriterMode)
    ).toBe(false);
  });

  it("claimShortcut prevents default and stops propagation", () => {
    let prevented = false;
    let stopped = false;
    let immediate = false;
    const e = {
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
      stopImmediatePropagation: () => {
        immediate = true;
      },
    } as unknown as KeyboardEvent;
    claimShortcut(e);
    expect(prevented && stopped && immediate).toBe(true);
  });
});

describe("输入焦点与快捷键放行", () => {
  it("认得 contenteditable —— CodeMirror / 混合模式的编辑区就是它", () => {
    // 按 tagName 判不出来：CM 的 .cm-content 是 div，只能靠 isContentEditable。
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "div", isContentEditable: true })).toBe(true);
  });

  it("INPUT / TEXTAREA / SELECT 都算输入区", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "select" })).toBe(true);
  });

  it("普通元素、空值、非对象都不是输入区", () => {
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("div")).toBe(false);
  });

  it("打字机滚动在输入中仍放行", () => {
    // 这条是功能可用性的底线：写作时按不出来，等于快捷键不存在。
    expect(shortcutAllowedWhileTyping("typewriterMode", true)).toBe(true);
    expect(shortcutAllowedWhileTyping("typewriterMode", false)).toBe(true);
  });

  it("其余快捷键仍然让位给输入，避免吞掉字符", () => {
    for (const action of [
      "save",
      "toggleSource",
      "findReplace",
      "toggleToc",
      "focusMode",
    ] as const) {
      expect(shortcutAllowedWhileTyping(action, true)).toBe(false);
      expect(shortcutAllowedWhileTyping(action, false)).toBe(true);
    }
  });

  it("放行名单是显式的，不靠处处写特例", () => {
    expect([...SHORTCUTS_ALLOWED_WHILE_TYPING]).toEqual(["typewriterMode"]);
  });
});
