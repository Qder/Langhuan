import { describe, expect, it } from "vitest";
import {
  MAX_LIBRARY_IMAGE_BYTES,
  formatLibraryImageBytes,
  insertImageMarkdownAt,
  insertImageMarkdownInline,
  resolvePreviewImageInsertAt,
  suggestedImageFilename,
  validateLibraryImageFile,
} from "./imageUpload";

describe("validateLibraryImageFile", () => {
  it("accepts png by mime", () => {
    const r = validateLibraryImageFile({
      type: "image/png",
      name: "a.png",
      size: 12,
    });
    expect(r).toEqual({ ok: true, mime: "image/png" });
  });

  it("accepts empty mime when extension is an image (Android picker)", () => {
    const r = validateLibraryImageFile({
      type: "",
      name: "shot.JPEG",
      size: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toBe("image/jpeg");
  });

  it("rejects non-image", () => {
    const r = validateLibraryImageFile({
      type: "application/pdf",
      name: "a.pdf",
      size: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/仅支持图片/);
  });

  it("rejects oversized files with a clear message", () => {
    const r = validateLibraryImageFile({
      type: "image/png",
      name: "big.png",
      size: MAX_LIBRARY_IMAGE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/过大/);
      expect(r.message).toContain(formatLibraryImageBytes(MAX_LIBRARY_IMAGE_BYTES));
    }
  });

  it("rejects empty files", () => {
    const r = validateLibraryImageFile({
      type: "image/png",
      name: "empty.png",
      size: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("insertImageMarkdownAt", () => {
  const snip = "![图](./assets/1-a.png)";

  it("appends at EOF with paragraph spacing", () => {
    const src = "# 标题\n\n一段话\n";
    const next = insertImageMarkdownAt(src, src.length, snip);
    expect(next).toContain(snip);
    expect(next.endsWith("\n")).toBe(true);
    expect(next.indexOf(snip)).toBeGreaterThan(src.indexOf("一段话"));
  });

  it("inserts between paragraphs at captured offset", () => {
    const src = "第一段\n\n第二段\n";
    // after first paragraph block end (index of second blank? "第一段\n\n" length)
    const insertAt = "第一段\n\n".length;
    const next = insertImageMarkdownAt(src, insertAt, snip);
    const i = next.indexOf(snip);
    expect(i).toBeGreaterThan(next.indexOf("第一段"));
    expect(i).toBeLessThan(next.indexOf("第二段"));
    // neighbors preserved
    expect(next.startsWith("第一段")).toBe(true);
    expect(next.trimEnd().endsWith("第二段")).toBe(true);
  });

  it("does not mutate when snippet is empty", () => {
    const src = "hello\n";
    expect(insertImageMarkdownAt(src, 0, "   ")).toBe(src);
  });
});

describe("insertImageMarkdownInline", () => {
  it("splices at caret without rewriting the rest", () => {
    const src = "aaabbb";
    expect(insertImageMarkdownInline(src, 3, "![x](./a.png)")).toBe(
      "aaa![x](./a.png)bbb"
    );
  });
});

describe("resolvePreviewImageInsertAt", () => {
  it("falls back to EOF without root/src", () => {
    expect(
      resolvePreviewImageInsertAt({
        root: null,
        clientY: 0,
        sourceLength: 42,
      })
    ).toBe(42);
  });

  it("uses srcEnd when provided without DOM geometry", () => {
    expect(
      resolvePreviewImageInsertAt({
        root: null,
        clientY: 10,
        srcStart: 5,
        srcEnd: 20,
        sourceLength: 100,
      })
    ).toBe(20);
  });
});

describe("suggestedImageFilename", () => {
  it("keeps file name when present", () => {
    expect(
      suggestedImageFilename({ name: "shot.png", type: "image/png" }, "image/png")
    ).toBe("shot.png");
  });
  it("derives from mime when nameless", () => {
    expect(suggestedImageFilename({ type: "image/jpeg" }, "image/jpeg")).toBe(
      "image.jpg"
    );
  });
});
