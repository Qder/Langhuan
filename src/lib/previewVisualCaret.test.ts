import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { replaceRange } from "./mdInlineEdit";
import {
  mergeVisualSlices,
  mdVisibleToPlainLength,
  isCaretAtVisualBlockStart,
  plainCaretOffsetIn,
  splitVisualSlice,
  isMergeBoundaryType,
  mountIsolatedVisualHost,
  splitVisualAtCaret,
  EMPTY_PARA_PLACEHOLDER,
} from "./previewVisualCaret";
import { classifyMdBlock } from "./mdVisualSerialize";

describe("splitVisualSlice — paragraph Enter", () => {
  it("splits at caret into two paragraphs with blank line", () => {
    const slice = "你好大家好\n";
    const r = splitVisualSlice({
      slice,
      blockType: "paragraph",
      plainOffset: 2,
      plainText: "你好大家好",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toBe("你好\n\n大家好\n");
    expect(r.writeText.slice(r.nextLocalStart, r.nextLocalEnd)).toBe("大家好\n");
    expect(r.nextBlockType).toBe("paragraph");
  });

  it("replaceRange keeps neighbors byte-identical on paragraph split", () => {
    const src = "# Title\n\n你好大家好\n\n## Next\n";
    const start = src.indexOf("你好");
    const end = start + "你好大家好\n".length;
    const r = splitVisualSlice({
      slice: src.slice(start, end),
      blockType: "paragraph",
      plainOffset: 2,
      plainText: "你好大家好",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    const next = replaceRange(src, start, end, r.writeText);
    expect(next.slice(0, start)).toBe(src.slice(0, start));
    expect(next.endsWith("\n## Next\n")).toBe(true);
    expect(next).toBe("# Title\n\n你好\n\n大家好\n\n## Next\n");
  });
});

describe("splitVisualSlice — heading Enter", () => {
  it("keeps heading prefix and opens a paragraph below", () => {
    const slice = "## Spring Boot\n";
    const r = splitVisualSlice({
      slice,
      blockType: "heading",
      plainOffset: "Spring Boot".length,
      plainText: "Spring Boot",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toBe("## Spring Boot\n\n\n");
    expect(r.nextBlockType).toBe("paragraph");
    expect(r.writeText.slice(r.nextLocalStart, r.nextLocalEnd)).toBe("\n");
  });

  it("moves text after caret into the new paragraph", () => {
    const slice = "# Hello World\n";
    const r = splitVisualSlice({
      slice,
      blockType: "heading",
      plainOffset: 5, // after "Hello"
      plainText: "Hello World",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toBe("# Hello\n\n World\n");
  });
});

describe("splitVisualSlice — list item Enter", () => {
  it("nonempty item creates a new item at caret", () => {
    const slice = "- 内容A\n";
    const r = splitVisualSlice({
      slice,
      blockType: "listItem",
      plainOffset: 2,
      plainText: "内容A",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toBe("- 内容\n- A\n");
    expect(r.nextBlockType).toBe("listItem");
  });

  it("empty item deletes the line", () => {
    const slice = "- \n";
    const r = splitVisualSlice({
      slice,
      blockType: "listItem",
      plainOffset: 0,
      plainText: "",
    });
    expect(r).toEqual({ kind: "delete", writeText: "" });
  });

  it("numbered list bumps the next marker", () => {
    const slice = "1. alpha\n";
    const r = splitVisualSlice({
      slice,
      blockType: "listItem",
      plainOffset: 5,
      plainText: "alpha",
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toBe("1. alpha\n2. \n");
  });
});

describe("mergeVisualSlices — Backspace at block start", () => {
  it("merges two paragraphs and keeps neighbors intact", () => {
    const src = "前\n\n你好\n\n大家好\n\n后\n";
    const prevStart = src.indexOf("你好");
    const prevEnd = prevStart + "你好\n".length;
    const nextStart = src.indexOf("大家好");
    const nextEnd = nextStart + "大家好\n".length;
    const prevSlice = src.slice(prevStart, prevEnd);
    const nextSlice = src.slice(nextStart, nextEnd);
    const merged = mergeVisualSlices({
      prevSlice,
      nextSlice,
      prevType: "paragraph",
      nextType: "paragraph",
    });
    expect(merged).not.toBeNull();
    expect(merged!.writeText).toBe("你好大家好\n");
    expect(merged!.caretPlain).toBe(2);
    const next = replaceRange(src, prevStart, nextEnd, merged!.writeText);
    expect(next.slice(0, prevStart)).toBe(src.slice(0, prevStart));
    expect(next.slice(prevStart + merged!.writeText.length)).toBe(
      src.slice(nextEnd)
    );
    expect(next).toBe("前\n\n你好大家好\n\n后\n");
  });

  it("does not merge across source boundary types", () => {
    expect(isMergeBoundaryType("code")).toBe(true);
    expect(isMergeBoundaryType("mermaid")).toBe(true);
    expect(isMergeBoundaryType("math")).toBe(true);
    expect(isMergeBoundaryType("table")).toBe(true);
    expect(isMergeBoundaryType("callout")).toBe(true);
    expect(isMergeBoundaryType("paragraph")).toBe(false);
    expect(
      mergeVisualSlices({
        prevSlice: "```js\nx\n```\n",
        nextSlice: "hi\n",
        prevType: "code",
        nextType: "paragraph",
      })
    ).toBeNull();
  });

  it("merges list item into previous paragraph", () => {
    const merged = mergeVisualSlices({
      prevSlice: "intro\n",
      nextSlice: "- item\n",
      prevType: "paragraph",
      nextType: "listItem",
    });
    expect(merged!.writeText).toBe("introitem\n");
    expect(merged!.caretPlain).toBe(5);
  });
});

describe("classify helpers used by caret nav", () => {
  it("classifies common slices", () => {
    expect(classifyMdBlock("## H\n")).toBe("heading");
    expect(classifyMdBlock("- a\n")).toBe("listItem");
    expect(classifyMdBlock("para\n")).toBe("paragraph");
  });
});

describe("mountIsolatedVisualHost", () => {
  it("clones off the React-owned node and leaves anchor HTML untouched after CE mutation", () => {
    const dom = new JSDOM(
      `<article><p data-src-start="0" data-src-end="10">hello <strong>world</strong></p></article>`
    );
    const anchor = dom.window.document.querySelector("p") as HTMLElement;
    const before = anchor.innerHTML;
    const mounted = mountIsolatedVisualHost(anchor);
    expect(mounted).not.toBeNull();
    const { host, dispose } = mounted!;
    expect(host).not.toBe(anchor);
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.getAttribute("data-lh-inline-editor")).toBe("visual");
    expect(host.hasAttribute("data-src-start")).toBe(false);
    expect(anchor.hasAttribute("hidden")).toBe(true);
    expect(anchor.classList.contains("lh-inline-edit-hidden")).toBe(true);
    expect(anchor.getAttribute("data-lh-visual-anchor-hidden")).toBe("1");
    expect(anchor.style.display).toBe("none");
    expect(anchor.getAttribute("data-src-start")).toBe("0");

    // Simulate bold/typing mutating only the isolated host (classic CE vs React crash).
    const strong = host.querySelector("strong");
    expect(strong).toBeTruthy();
    strong!.replaceWith(dom.window.document.createTextNode("WORLD"));
    expect(host.textContent).toContain("WORLD");
    expect(anchor.innerHTML).toBe(before);

    dispose();
    expect(anchor.hasAttribute("hidden")).toBe(false);
    expect(anchor.classList.contains("lh-inline-edit-hidden")).toBe(false);
    expect(anchor.style.display).toBe("");
    expect(anchor.innerHTML).toBe(before);
    expect(host.isConnected).toBe(false);
    // Src-range queries still see exactly one owner node
    const hits = [
      ...dom.window.document.querySelectorAll("[data-src-start]"),
    ];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(anchor);
  });

  it("keeps only one visible copy for list items (no twin TOC line)", () => {
    const dom = new JSDOM(
      `<article><ul><li data-src-start="0" data-src-end="20"><a data-src-start="2" data-src-end="8">0. 目录</a></li></ul></article>`
    );
    const anchor = dom.window.document.querySelector("li") as HTMLElement;
    const mounted = mountIsolatedVisualHost(anchor)!;
    const { host, dispose } = mounted;
    const ul = anchor.parentElement!;
    const visualHosts = [
      ...ul.querySelectorAll("[data-lh-inline-editor=visual]"),
    ];
    expect(visualHosts).toHaveLength(1);
    expect(visualHosts[0]).toBe(host);
    // Anchor fully suppressed; nested src stamps stripped from clone only.
    expect(anchor.style.display).toBe("none");
    expect(host.querySelector("[data-src-start]")).toBeNull();
    expect(anchor.querySelector("[data-src-start]")?.getAttribute("data-src-start")).toBe("2");
    dispose();
    expect(ul.querySelectorAll("[data-lh-inline-editor=visual]")).toHaveLength(0);
    expect(anchor.style.display).toBe("");
  });

  it("removes orphan hosts on remount and dispose is idempotent", () => {
    const dom = new JSDOM(
      `<article><p data-src-start="0" data-src-end="5">hi</p></article>`
    );
    const anchor = dom.window.document.querySelector("p") as HTMLElement;
    const first = mountIsolatedVisualHost(anchor)!;
    // Simulate interrupted cleanup: leave host, remount.
    const second = mountIsolatedVisualHost(anchor)!;
    expect(first.host.isConnected).toBe(false);
    expect(
      anchor.parentElement!.querySelectorAll("[data-lh-inline-editor=visual]")
    ).toHaveLength(1);
    second.dispose();
    second.dispose(); // idempotent
    expect(
      anchor.parentElement!.querySelectorAll("[data-lh-inline-editor=visual]")
    ).toHaveLength(0);
    expect(anchor.hasAttribute("hidden")).toBe(false);
  });
});

describe("splitVisualAtCaret — isolated host Enter path", () => {
  function caretAtEnd(el: HTMLElement) {
    const doc = el.ownerDocument!;
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function caretAfterPlainOffset(
    el: HTMLElement,
    offset: number,
    dom: import("jsdom").JSDOM
  ) {
    const doc = el.ownerDocument!;
    const walker = doc.createTreeWalker(el, dom.window.NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const len = node.data.length;
      if (remaining <= len) {
        const range = doc.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const sel = doc.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
      node = walker.nextNode() as Text | null;
    }
    caretAtEnd(el);
  }

  it("Enter at end of dense code paragraph yields ZWSP next para + keeps code fences", () => {
    const dom = new JSDOM(
      `<!doctype html><p>表单里 <code>name</code> 和 <code>id</code> 别混，样式归 CSS。</p>`
    );
    const el = dom.window.document.querySelector("p") as HTMLElement;
    // jsdom needs window selection hooked for some APIs
    (globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document;
    caretAtEnd(el);
    const original =
      "表单里 `name` 和 `id` 别混，样式归 CSS。\n";
    const r = splitVisualAtCaret({
      element: el,
      blockType: "paragraph",
      originalSlice: original,
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    expect(r.writeText).toContain("`name`");
    expect(r.writeText).toContain("`id`");
    const next = r.writeText.slice(r.nextLocalStart, r.nextLocalEnd);
    expect(next.startsWith(EMPTY_PARA_PLACEHOLDER)).toBe(true);
    // Two paragraphs separated by a blank line
    expect(r.writeText.includes("\n\n")).toBe(true);
  });

  it("Enter mid dense paragraph splits and preserves inline code on both sides", () => {
    const dom = new JSDOM(
      `<!doctype html><p>AAA <code>name</code> BBB <code>id</code> CCC</p>`
    );
    const el = dom.window.document.querySelector("p") as HTMLElement;
    (globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document;
    // plain: "AAA name BBB id CCC" — split after "AAA name BBB " (offset 13)
    caretAfterPlainOffset(el, "AAA name BBB ".length, dom);
    const original = "AAA `name` BBB `id` CCC\n";
    const r = splitVisualAtCaret({
      element: el,
      blockType: "paragraph",
      originalSlice: original,
    });
    expect(r.kind).toBe("split");
    if (r.kind !== "split") return;
    const left = r.writeText.slice(0, r.nextLocalStart);
    const right = r.writeText.slice(r.nextLocalStart, r.nextLocalEnd);
    expect(left).toContain("`name`");
    expect(right).toContain("`id`");
    expect(left.includes("`id`")).toBe(false);
    expect(right.includes("`name`")).toBe(false);
  });
});

describe("mdVisibleToPlainLength — merge caret vs DOM", () => {
  it("strips inline code markers so caret lands at junction", () => {
    expect(mdVisibleToPlainLength("ab`cd`ef")).toBe(6);
    expect(mdVisibleToPlainLength("你好**世界**")).toBe(4);
  });

  it("merge caretPlain uses plain length not md length", () => {
    const merged = mergeVisualSlices({
      prevSlice: "see `x` now\n",
      nextSlice: "more\n",
      prevType: "paragraph",
      nextType: "paragraph",
    });
    expect(merged).not.toBeNull();
    // visible "see `x` now" md len 11, plain "see x now" len 9
    expect(merged!.caretPlain).toBe(9);
    expect(merged!.writeText).toBe("see `x` nowmore\n");
  });
});

describe("isCaretAtVisualBlockStart — null-safe Backspace gate", () => {
  it("returns false when selection is missing (no false merge)", () => {
    const dom = new JSDOM(`<p id="h">hello</p>`);
    const el = dom.window.document.getElementById("h") as HTMLElement;
    expect(isCaretAtVisualBlockStart(el)).toBe(false);
  });

  it("returns true at offset 0 on empty / ZWSP-only host", () => {
    const dom = new JSDOM(`<!DOCTYPE html><p id="h"></p>`);
    const el = dom.window.document.getElementById("h") as HTMLElement;
    el.textContent = "\u200b";
    const doc = dom.window.document;
    const range = doc.createRange();
    range.setStart(el.firstChild!, 0);
    range.collapse(true);
    const sel = dom.window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(plainCaretOffsetIn(el)).toBe(0);
    expect(isCaretAtVisualBlockStart(el)).toBe(true);
  });

  it("returns false when caret mid-block", () => {
    const dom = new JSDOM(`<!DOCTYPE html><p id="h">hello</p>`);
    const el = dom.window.document.getElementById("h") as HTMLElement;
    const doc = dom.window.document;
    const range = doc.createRange();
    range.setStart(el.firstChild!, 3);
    range.collapse(true);
    const sel = dom.window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(plainCaretOffsetIn(el)).toBe(3);
    expect(isCaretAtVisualBlockStart(el)).toBe(false);
  });

  it("does not merge when leading ZWSP precedes real text", () => {
    const dom = new JSDOM(`<!DOCTYPE html><p id="h"></p>`);
    const el = dom.window.document.getElementById("h") as HTMLElement;
    el.textContent = "\u200b" + "hi";
    const doc = dom.window.document;
    const range = doc.createRange();
    range.setStart(el.firstChild!, 0);
    range.collapse(true);
    const sel = dom.window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(isCaretAtVisualBlockStart(el)).toBe(false);
  });
});
