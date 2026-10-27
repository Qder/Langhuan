import { describe, expect, it } from "vitest";
import {
  extFromMime,
  isAssetLikePath,
  markdownImageSnippet,
  relativeAssetHref,
  sanitizeAssetFilename,
  suggestAssetPath,
} from "./paths";

describe("sanitizeAssetFilename", () => {
  it("strips path and unsafe chars", () => {
    expect(sanitizeAssetFilename("../../a b/照片*.png")).toBe("照片-.png");
    expect(sanitizeAssetFilename("")).toBe("image");
  });
});

describe("suggestAssetPath / relativeAssetHref", () => {
  it("places under doc assets/ with unique stamp", () => {
    const p = suggestAssetPath("笔记/a.md", "shot.png", [], 1);
    expect(p).toBe("笔记/assets/1-shot.png");
    expect(relativeAssetHref("笔记/a.md", p)).toBe("./assets/1-shot.png");
  });

  it("avoids collisions", () => {
    const existing = ["笔记/assets/1-shot.png"];
    const p = suggestAssetPath("笔记/a.md", "shot.png", existing, 1);
    expect(p).toBe("笔记/assets/1-shot-2.png");
  });

  it("cross-folder relative", () => {
    expect(relativeAssetHref("笔记/子/a.md", "笔记/assets/x.png")).toBe(
      "../assets/x.png"
    );
  });
});

describe("mime helpers / snippet", () => {
  it("maps mime ↔ ext", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(markdownImageSnippet("./assets/a.png", "图")).toBe("![图](./assets/a.png)");
  });
  it("detects asset-like paths", () => {
    expect(isAssetLikePath("笔记/assets/a.png")).toBe(true);
    expect(isAssetLikePath("笔记/a.md")).toBe(false);
  });
});
