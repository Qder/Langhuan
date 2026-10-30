// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  applyExternalDoc,
  clampSelectionToDoc,
} from "./editorExternalSync";

describe("clampSelectionToDoc", () => {
  it("clamps into [0, len]", () => {
    const sel = clampSelectionToDoc(10, 20, 5);
    expect(sel.main.anchor).toBe(5);
    expect(sel.main.head).toBe(5);
  });

  it("preserves in-range caret", () => {
    const sel = clampSelectionToDoc(2, 4, 10);
    expect(sel.main.anchor).toBe(2);
    expect(sel.main.head).toBe(4);
  });
});

describe("applyExternalDoc", () => {
  function makeView(doc: string, anchor = 0, head = anchor) {
    const state = EditorState.create({
      doc,
      selection: { anchor, head },
    });
    return new EditorView({ state });
  }

  it("returns no-view when null", () => {
    expect(applyExternalDoc(null, "x")).toEqual({
      applied: false,
      reason: "no-view",
    });
  });

  it("no-ops when content is identical", () => {
    const view = makeView("hello", 3);
    const r = applyExternalDoc(view, "hello");
    expect(r).toEqual({ applied: false, reason: "same" });
    expect(view.state.selection.main.head).toBe(3);
    view.destroy();
  });

  it("replaces doc and clamps caret instead of resetting to 0", () => {
    const view = makeView("hello world", 11);
    const r = applyExternalDoc(view, "hi");
    expect(r).toEqual({ applied: true });
    expect(view.state.doc.toString()).toBe("hi");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });

  it("keeps caret when next doc is longer", () => {
    const view = makeView("ab", 2);
    applyExternalDoc(view, "abcd");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });
});
