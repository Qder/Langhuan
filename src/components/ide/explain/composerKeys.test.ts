import { describe, expect, it } from "vitest";
import { shouldSendOnExplainComposerKey } from "./composerKeys";

function key(
  partial: Partial<Parameters<typeof shouldSendOnExplainComposerKey>[0]> & { key: string }
) {
  return {
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...partial,
  };
}

describe("shouldSendOnExplainComposerKey", () => {
  it("sends on bare Enter", () => {
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter" }))).toBe(true);
  });

  it("sends on Ctrl/⌘+Enter (same as Enter)", () => {
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter", metaKey: true }))).toBe(true);
  });

  it("does not send on Shift+Enter (newline)", () => {
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter", shiftKey: true }))).toBe(false);
  });

  it("does not send while IME is composing", () => {
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter", isComposing: true }))).toBe(false);
    expect(
      shouldSendOnExplainComposerKey(key({ key: "Enter", nativeEvent: { isComposing: true } }))
    ).toBe(false);
    expect(shouldSendOnExplainComposerKey(key({ key: "Enter", keyCode: 229 }))).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSendOnExplainComposerKey(key({ key: "a" }))).toBe(false);
  });
});
