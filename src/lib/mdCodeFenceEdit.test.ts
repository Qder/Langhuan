import { describe, expect, it } from "vitest";
import {
  classifyMdBlock,
  fenceBodyOffsetFromSliceOffset,
  isCodeFenceEditType,
  isSourceEditType,
  isVisualEditableType,
  parseMarkdownFence,
  previewBlockEditMode,
  rebuildMarkdownFence,
} from "./mdVisualSerialize";
import { isMonoSrcSlice, replaceRange } from "./mdInlineEdit";
import { removeOrphanCodeFenceHosts } from "@/components/editor/InlineCodeFenceEditor";

describe("parseMarkdownFence / rebuildMarkdownFence", () => {
  it("parses ```lang body and preserves lang on rebuild", () => {
    const slice = "```html\n<!DOCTYPE html>\n<html></html>\n```\n";
    const p = parseMarkdownFence(slice);
    expect(p).not.toBeNull();
    expect(p!.lang).toBe("html");
    expect(p!.info).toBe("html");
    expect(p!.body).toBe("<!DOCTYPE html>\n<html></html>");
    const next = rebuildMarkdownFence(p!, "<!DOCTYPE html>\n<html lang=\"zh\"></html>");
    expect(next).toBe(
      "```html\n<!DOCTYPE html>\n<html lang=\"zh\"></html>\n```\n"
    );
  });

  it("parses ~~~ fences and empty body", () => {
    const slice = "~~~js\n~~~\n";
    const p = parseMarkdownFence(slice);
    expect(p).not.toBeNull();
    expect(p!.ch).toBe("~");
    expect(p!.body).toBe("");
    expect(rebuildMarkdownFence(p!, "x = 1")).toBe("~~~js\nx = 1\n~~~\n");
  });

  it("maps slice caret into body offsets", () => {
    const slice = "```js\nabc\n```";
    const p = parseMarkdownFence(slice)!;
    // openLine "```js" + \n = 6
    expect(fenceBodyOffsetFromSliceOffset(p, 0)).toBe(0);
    expect(fenceBodyOffsetFromSliceOffset(p, 6)).toBe(0);
    expect(fenceBodyOffsetFromSliceOffset(p, 7)).toBe(1); // 'b'
    expect(fenceBodyOffsetFromSliceOffset(p, 9)).toBe(3); // end of body
    expect(fenceBodyOffsetFromSliceOffset(p, 99)).toBe(3);
  });

  it("Enter-inside-fence model: body keeps newlines; replaceRange writes fence", () => {
    const src = "para\n\n```js\nline1\n```\n\nafter\n";
    const start = src.indexOf("```js");
    const end = src.indexOf("\n\nafter");
    const p = parseMarkdownFence(src.slice(start, end))!;
    // Simulate Enter inserting newline in body (NOT splitting out of fence)
    const body2 = "line1\nline2";
    const nextSlice = rebuildMarkdownFence(p, body2);
    const next = replaceRange(src, start, end, nextSlice);
    expect(next).toContain("```js\nline1\nline2\n```");
    expect(next.startsWith("para\n\n")).toBe(true);
    expect(next.includes("\n\nafter\n")).toBe(true);
    // Still one fence block — no paragraph split
    expect(classifyMdBlock(nextSlice)).toBe("code");
  });
});

describe("previewBlockEditMode policy", () => {
  it("plain code → code mode; mermaid/math/table stay source; para visual", () => {
    expect(previewBlockEditMode("code", true)).toBe("code");
    expect(previewBlockEditMode("mermaid", true)).toBe("source");
    expect(previewBlockEditMode("math", true)).toBe("source");
    expect(previewBlockEditMode("table", true)).toBe("source");
    expect(previewBlockEditMode("callout", true)).toBe("source");
    expect(previewBlockEditMode("paragraph", false)).toBe("visual");
    expect(isCodeFenceEditType("code")).toBe(true);
    expect(isCodeFenceEditType("mermaid")).toBe(false);
    // serialize path still treats code as non-visual
    expect(isVisualEditableType("code")).toBe(false);
    expect(isSourceEditType("code")).toBe(true);
    expect(isMonoSrcSlice("```js\nx\n```\n")).toBe(true);
  });

  it("classify keeps mermaid off the seamless code path", () => {
    const m = "```mermaid\ngraph TD\nA-->B\n```\n";
    expect(classifyMdBlock(m)).toBe("mermaid");
    expect(previewBlockEditMode(classifyMdBlock(m), true)).toBe("source");
  });
});

describe("removeOrphanCodeFenceHosts", () => {
  it("removes implanted code hosts but can keep one", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    const document = dom.window.document;
    const scope = document.createElement("div");
    const keep = document.createElement("div");
    keep.setAttribute("data-lh-inline-editor", "code");
    const orphan = document.createElement("div");
    orphan.setAttribute("data-lh-inline-editor", "code");
    const other = document.createElement("div");
    other.setAttribute("data-lh-inline-editor", "1");
    scope.append(keep, orphan, other);
    expect(removeOrphanCodeFenceHosts(scope, keep)).toBe(1);
    expect(scope.contains(keep)).toBe(true);
    expect(scope.contains(orphan)).toBe(false);
    expect(scope.contains(other)).toBe(true);
  });

  it("replaceRange after rebuild does not duplicate fence in source", () => {
    const src = "intro\n\n```html\n<a/>\n```\n\noutro\n";
    const start = src.indexOf("```html");
    const end = src.indexOf("\n\noutro");
    const slice = src.slice(start, end);
    const p = parseMarkdownFence(slice)!;
    const nextSlice = rebuildMarkdownFence(p, "<a lang/>");
    const after = replaceRange(src, start, end, nextSlice);
    const hits = after.split("```html").length - 1;
    expect(hits).toBe(1);
    expect(after).toContain("```html\n<a lang/>\n```");
  });
});
