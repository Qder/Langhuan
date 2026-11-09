// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineVisualBlockEditor, type InlineVisualBlockEditorProps } from "./InlineVisualBlockEditor";
import { flushVisualEdit, takeVisualEdit } from "@/lib/previewVisualCaret";
import { serializeVisualBlock, type VisualBlockType } from "@/lib/mdVisualSerialize";
import { replaceRange } from "@/lib/mdInlineEdit";

vi.mock("@/lib/store", () => ({ useStore: { getState: () => ({}) } }));
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

const sentence = "(6) 的逆命题不成立（见例4.4）。";
const deleted = "你好，我是打算";
function mount(blockType: VisualBlockType = "paragraph", extra: Partial<InlineVisualBlockEditorProps> = {}) {
  const originalSlice = (blockType === "listItem" ? "- " : "") + sentence + deleted;
  const anchor = document.createElement(blockType === "listItem" ? "li" : "p");
  anchor.textContent = sentence + deleted;
  container.append(anchor);
  const slot = document.createElement("div");
  container.append(slot);
  let source = `前段 **不应改**\n\n${originalSlice}\n\n后段 \`code\``;
  const start = source.indexOf(originalSlice);
  const end = start + originalSlice.length;
  const onCommit = vi.fn((slice: string) => { source = replaceRange(source, start, end, slice); });
  const onCancel = vi.fn();
  const props: InlineVisualBlockEditorProps = {
    docId: "test-visual", anchorEl: anchor, originalSlice, blockType,
    srcStart: start, srcEnd: end, remountEpoch: 1, onCommit, onCancel, ...extra,
  };
  root = createRoot(slot);
  act(() => root!.render(<InlineVisualBlockEditor {...props} />));
  const host = container.querySelector<HTMLElement>('[data-lh-inline-editor="visual"]')!;
  return { host, anchor, onCommit, onCancel, originalSlice, source: () => source, props };
}

// jsdom has no native editing default action: dispatch the actual beforeinput /
// DOM deletion / input sequence explicitly. Browser/WebView IME still needs smoke.
function nativeDelete(host: HTMLElement, type: string, from: number, to: number) {
  const text = host.firstChild!;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: type });
  host.dispatchEvent(before);
  if (!before.defaultPrevented) {
    range.deleteContents();
    host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: type }));
  }
  return before;
}

function blur(host: HTMLElement) {
  act(() => { host.dispatchEvent(new FocusEvent("blur")); vi.runAllTimers(); });
}

describe("visual edit single live session", () => {
  it.each(["paragraph", "listItem"] as const)("click-before-blur consumes LIVE %s, not the hidden stale anchor", (type) => {
    const x = mount(type);
    nativeDelete(x.host, "deleteContentBackward", sentence.length, sentence.length + deleted.length);
    // Regression witness: this is exactly what the old parent serialized.
    expect(serializeVisualBlock({ originalSlice: x.originalSlice, blockType: type, element: x.anchor })).toContain(deleted);
    let snapshot: ReturnType<typeof takeVisualEdit>;
    act(() => {
      x.host.dispatchEvent(new FocusEvent("blur")); // delayed blur has not run
      snapshot = takeVisualEdit(x.anchor); // parent click commits synchronously
      if (snapshot && "slice" in snapshot) x.onCommit(snapshot.slice);
      vi.runAllTimers();
    });
    expect(snapshot!).toEqual({ slice: (type === "listItem" ? "- " : "") + sentence });
    expect(x.onCommit).toHaveBeenCalledTimes(1);
    expect(x.source()).not.toContain(deleted);
    expect(x.source()).toContain("前段 **不应改**");
    expect(x.source()).toContain("后段 `code`");
  });

  it.each(["deleteContentBackward", "deleteContentForward", "deleteByCut"])("%s persists through blur and reopen", (type) => {
    const x = mount();
    nativeDelete(x.host, type, sentence.length, sentence.length + deleted.length);
    blur(x.host);
    expect(x.source()).not.toContain(deleted);
    act(() => root!.unmount()); root = undefined;
    // Re-render/reopen from the committed Markdown, not from the retired host.
    x.anchor.textContent = sentence;
    const slot = document.createElement("div"); container.append(slot);
    root = createRoot(slot);
    act(() => root!.render(<InlineVisualBlockEditor {...x.props} originalSlice={sentence} remountEpoch={2} />));
    expect(container.querySelector('[data-lh-inline-editor="visual"]')?.textContent).toBe(sentence);
  });

  it.each(["paragraph", "listItem"] as const)("deleting the entire %s does not restore its previous text", (type) => {
    const x = mount(type);
    nativeDelete(x.host, "deleteContentBackward", 0, x.host.textContent!.length);
    blur(x.host);
    expect(x.onCommit).toHaveBeenCalledWith(type === "listItem" ? "- " : "");
    expect(x.source()).not.toContain(deleted);
  });

  it("save while focused flushes before reading source; later blur is idempotent", () => {
    const x = mount();
    nativeDelete(x.host, "deleteContentForward", sentence.length, sentence.length + deleted.length);
    act(() => expect(flushVisualEdit("test-visual")).toBe(true));
    expect(x.source()).not.toContain(deleted);
    blur(x.host);
    expect(x.onCommit).toHaveBeenCalledTimes(1);
  });

  it("mode/tab unmount before blur preserves changed text once", () => {
    const x = mount();
    nativeDelete(x.host, "deleteContentBackward", sentence.length, sentence.length + deleted.length);
    act(() => { x.host.dispatchEvent(new FocusEvent("blur")); root!.unmount(); });
    root = undefined;
    act(() => vi.runAllTimers());
    expect(x.onCommit).toHaveBeenCalledTimes(1);
    expect(x.source()).not.toContain(deleted);
    expect(flushVisualEdit("test-visual")).toBe(true);
  });

  it("Chinese composition is not split/merged/cancelled by candidate keys or beforeinput", () => {
    const onSplit = vi.fn(() => true), onMergePrev = vi.fn(() => true);
    const x = mount("paragraph", { onSplit, onMergePrev });
    x.host.dispatchEvent(new CompositionEvent("compositionstart"));
    for (const key of ["Enter", "Escape", "Backspace", "ArrowLeft"]) {
      x.host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    }
    const enter = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph", isComposing: true });
    x.host.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    act(() => expect(flushVisualEdit("test-visual")).toBe(false));
    blur(x.host);
    expect(x.onCommit).not.toHaveBeenCalled();
    x.host.textContent = sentence + "中文";
    act(() => {
      x.host.dispatchEvent(new CompositionEvent("compositionend"));
      // Final input follows compositionend on some Android WebViews.
      x.host.textContent = sentence + "中文完成";
      x.host.dispatchEvent(new InputEvent("input", { inputType: "insertText" }));
      vi.runAllTimers();
    });
    expect(x.onCommit).toHaveBeenCalledWith(sentence + "中文完成");
    expect(onSplit).not.toHaveBeenCalled(); expect(onMergePrev).not.toHaveBeenCalled();
    expect(x.onCancel).not.toHaveBeenCalled();
  });

  it("Android beforeinput-only backward deletion merges at a collapsed block start", () => {
    const onMergePrev = vi.fn(() => true);
    const x = mount("listItem", { onMergePrev });
    const range = document.createRange(); range.setStart(x.host.firstChild!, 0); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const e = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
    x.host.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); expect(onMergePrev).toHaveBeenCalledTimes(1);
    blur(x.host); expect(x.onCommit).not.toHaveBeenCalled();
  });

  it("a retired blur cannot commit into the next session", () => {
    const x = mount();
    nativeDelete(x.host, "deleteContentBackward", sentence.length, sentence.length + deleted.length);
    const nextAnchor = document.createElement("p"); nextAnchor.textContent = "下一段";
    container.append(nextAnchor);
    const nextCommit = vi.fn();
    act(() => {
      x.host.dispatchEvent(new FocusEvent("blur"));
      root!.render(<InlineVisualBlockEditor {...x.props} anchorEl={nextAnchor}
        originalSlice="下一段" onCommit={nextCommit} remountEpoch={2} />);
    });
    act(() => vi.runAllTimers());
    expect(x.onCommit).toHaveBeenCalledTimes(1);
    expect(x.source()).not.toContain(deleted);
    expect(nextCommit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-lh-inline-editor="visual"]')?.textContent).toBe("下一段");
  });

  it("Android Enter in a table cell commits instead of splitting the GFM row", () => {
    const onSplit = vi.fn(() => true);
    const x = mount("tableCell", { originalSlice: "| 单元格 |", onSplit });
    x.host.textContent = "修改后";
    const e = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
    x.host.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(onSplit).not.toHaveBeenCalled();
    expect(x.onCommit).toHaveBeenCalledWith("| 修改后 |");
  });

  it("preserves inline formatting and unaffected blocks after deletion", () => {
    const x = mount();
    x.host.innerHTML = `<strong>保留粗体</strong> <code>code</code>${deleted}`;
    const node = x.host.lastChild!;
    const range = document.createRange(); range.selectNodeContents(node); range.deleteContents();
    x.host.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward" }));
    blur(x.host);
    expect(x.source()).toContain("**保留粗体** `code`");
    expect(x.source()).not.toContain(deleted);
    expect(x.source()).toContain("前段 **不应改**");
  });

  it("Escape intentionally cancels, and unchanged StrictMode cleanup never commits", () => {
    const x = mount();
    x.host.textContent = "应取消";
    act(() => x.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
    act(() => root!.unmount()); root = undefined;
    expect(x.onCancel).toHaveBeenCalledTimes(1); expect(x.onCommit).not.toHaveBeenCalled();
    const slot = document.createElement("div"); container.append(slot); root = createRoot(slot);
    act(() => root!.render(<React.StrictMode><InlineVisualBlockEditor {...x.props} /></React.StrictMode>));
    expect(container.querySelectorAll('[data-lh-inline-editor="visual"]')).toHaveLength(1);
    expect(x.onCommit).not.toHaveBeenCalled();
  });
});
