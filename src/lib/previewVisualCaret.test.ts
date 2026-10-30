import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { replaceRange } from "./mdInlineEdit";
import {
  mergeVisualSlices,
  splitVisualSlice,
  isMergeBoundaryType,
  mountIsolatedVisualHost,
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
    expect(anchor.getAttribute("data-src-start")).toBe("0");

    // Simulate bold/typing mutating only the isolated host (classic CE vs React crash).
    const strong = host.querySelector("strong");
    expect(strong).toBeTruthy();
    strong!.replaceWith(dom.window.document.createTextNode("WORLD"));
    expect(host.textContent).toContain("WORLD");
    expect(anchor.innerHTML).toBe(before);

    dispose();
    expect(anchor.hasAttribute("hidden")).toBe(false);
    expect(anchor.innerHTML).toBe(before);
    expect(host.isConnected).toBe(false);
    // Src-range queries still see exactly one owner node
    const hits = [
      ...dom.window.document.querySelectorAll("[data-src-start]"),
    ];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(anchor);
  });
});
