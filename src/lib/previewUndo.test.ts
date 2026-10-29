import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  PREVIEW_UNDO_LIMIT,
  clearPreviewUndoStacks,
  emptyPreviewUndoStacks,
  isFocusInCodeMirror,
  pushPreviewUndoEntry,
  redoPreviewEntry,
  shouldHandlePreviewUndoShortcut,
  undoPreviewEntry,
} from "./previewUndo";

describe("previewUndo stacks", () => {
  it("two pushes then undo twice restores original; redo advances one", () => {
    let stacks = emptyPreviewUndoStacks();
    const v0 = "v0";
    const v1 = "v1";
    const v2 = "v2";

    stacks = pushPreviewUndoEntry(stacks, v0);
    let current = v1;
    stacks = pushPreviewUndoEntry(stacks, v1);
    current = v2;

    const u1 = undoPreviewEntry(stacks, current);
    expect(u1).not.toBeNull();
    expect(u1!.content).toBe(v1);
    stacks = u1!.stacks;
    current = u1!.content;

    const u2 = undoPreviewEntry(stacks, current);
    expect(u2).not.toBeNull();
    expect(u2!.content).toBe(v0);
    stacks = u2!.stacks;
    current = u2!.content;

    const r1 = redoPreviewEntry(stacks, current);
    expect(r1).not.toBeNull();
    expect(r1!.content).toBe(v1);
  });

  it("caps undo at PREVIEW_UNDO_LIMIT", () => {
    let stacks = emptyPreviewUndoStacks();
    for (let i = 0; i < PREVIEW_UNDO_LIMIT + 10; i++) {
      stacks = pushPreviewUndoEntry(stacks, `c${i}`);
    }
    expect(stacks.undo.length).toBe(PREVIEW_UNDO_LIMIT);
    expect(stacks.undo[0]).toBe("c10");
    expect(stacks.redo).toEqual([]);
  });

  it("empty undo returns null and does not invent content", () => {
    const stacks = emptyPreviewUndoStacks();
    expect(undoPreviewEntry(stacks, "body")).toBeNull();
  });

  it("push clears redo", () => {
    let stacks = pushPreviewUndoEntry(emptyPreviewUndoStacks(), "a");
    const afterUndo = undoPreviewEntry(stacks, "b");
    expect(afterUndo).not.toBeNull();
    stacks = afterUndo!.stacks;
    expect(stacks.redo.length).toBe(1);
    stacks = pushPreviewUndoEntry(stacks, afterUndo!.content);
    expect(stacks.redo).toEqual([]);
  });

  it("clear empties both stacks", () => {
    let stacks = pushPreviewUndoEntry(emptyPreviewUndoStacks(), "x");
    stacks = clearPreviewUndoStacks();
    expect(stacks).toEqual({ undo: [], redo: [] });
  });
});

describe("previewUndo focus gate", () => {
  it("isFocusInCodeMirror detects .cm-editor ancestor", () => {
    const dom = new JSDOM(`<!doctype html><div class="cm-editor"><span id="x"></span></div><p id="out">hi</p>`);
    const inner = dom.window.document.getElementById("x");
    const out = dom.window.document.getElementById("out");
    expect(isFocusInCodeMirror(inner)).toBe(true);
    expect(isFocusInCodeMirror(out)).toBe(false);
    expect(isFocusInCodeMirror(null)).toBe(false);
  });

  it("when focus is in CM, preview undo handler is not invoked", () => {
    const dom = new JSDOM(`<!doctype html><div class="cm-editor"><span id="x"></span></div>`);
    const inner = dom.window.document.getElementById("x");
    let called = false;
    const runUndo = () => {
      called = true;
    };
    if (shouldHandlePreviewUndoShortcut(inner, false)) runUndo();
    expect(called).toBe(false);

    expect(shouldHandlePreviewUndoShortcut(dom.window.document.body, true)).toBe(false);
    expect(shouldHandlePreviewUndoShortcut(dom.window.document.body, false)).toBe(true);
  });
});
