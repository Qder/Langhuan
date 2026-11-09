import { describe, expect, it } from "vitest";
import {
  findMarkdownImageByHref,
  parseLhWidth,
  rewriteMarkdownImage,
  widthToCss,
} from "./mdImageEdit";

describe("mdImageEdit", () => {
  it("parses lh-w title", () => {
    expect(parseLhWidth("lh-w:50%")).toBe("50%");
    expect(parseLhWidth("lh-w:400px")).toBe("400px");
    expect(parseLhWidth("caption")).toBe("auto");
  });

  it("rewrites alt and width", () => {
    const src = "前\n![旧](./assets/a.png)\n后";
    const m = findMarkdownImageByHref(src, "./assets/a.png");
    expect(m).toBeTruthy();
    const next = rewriteMarkdownImage(src, m!, { alt: "新图", width: "50%" });
    expect(next).toContain('![新图](./assets/a.png "lh-w:50%")');
    expect(widthToCss("50%")).toBe("50%");
  });

  it("clears width back to auto", () => {
    const src = '![x](./assets/a.png "lh-w:75%")';
    const m = findMarkdownImageByHref(src, "a.png");
    const next = rewriteMarkdownImage(src, m!, { width: "auto" });
    expect(next).toBe("![x](./assets/a.png)");
  });
});
