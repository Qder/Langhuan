import { describe, expect, it } from "vitest";
import {
  collectFolders,
  formatImportStatus,
  importPreviewLabel,
  rewriteImportPath,
  rewriteImportPaths,
} from "./importPaths";
import { uniquePath } from "./utils";

describe("collectFolders", () => {
  it("collects unique dirname prefixes", () => {
    expect(collectFolders(["a.md", "笔记/foo.md", "笔记/算法/bar.md", "pages/x.html"])).toEqual([
      "笔记",
      "笔记/算法",
      "pages",
    ]);
  });
});

describe("rewriteImportPaths", () => {
  it("keeps paths at library root when no target", () => {
    const out = rewriteImportPaths([{ path: "foo.md", content: "x" }]);
    expect(out[0].path).toBe("foo.md");
  });

  it("prefixes flat files under target folder", () => {
    const out = rewriteImportPaths([{ path: "foo.md", content: "x" }], "笔记");
    expect(out[0].path).toBe("笔记/foo.md");
  });

  it("preserves relative tree under target", () => {
    const out = rewriteImportPaths(
      [{ path: "algo/spfa.md", content: "x" }],
      "笔记"
    );
    expect(out[0].path).toBe("笔记/algo/spfa.md");
  });

  it("trims slashes on target", () => {
    const out = rewriteImportPaths([{ path: "a.md", content: "x" }], "/笔记/");
    expect(out[0].path).toBe("笔记/a.md");
  });

  it("rewrites image asset paths with the same target prefix", () => {
    const out = rewriteImportPaths(
      [{ path: "figs/01-树的基本形态.png", blob: null as unknown as Blob, mime: "image/png" }],
      "笔记/树"
    );
    expect(out[0].path).toBe("笔记/树/figs/01-树的基本形态.png");
  });

  it("rewriteImportPath matches docs and assets", () => {
    expect(rewriteImportPath("figs/a.png", "笔记/树")).toBe("笔记/树/figs/a.png");
    expect(rewriteImportPath("note.md", "笔记/树")).toBe("笔记/树/note.md");
    expect(rewriteImportPath("figs/a.png")).toBe("figs/a.png");
  });
});

describe("import status / preview", () => {
  it("formatImportStatus covers doc+image batches", () => {
    expect(formatImportStatus(2, 3)).toBe("已导入 2 篇文档、3 张图片");
    expect(formatImportStatus(1, 0)).toBe("已导入 1 篇文档");
    expect(formatImportStatus(0, 4)).toBe("已导入 4 张图片");
    expect(formatImportStatus(0, 0)).toBe("没有可导入的文件");
  });

  it("importPreviewLabel mentions images", () => {
    expect(importPreviewLabel([{ path: "a.md" }], 2)).toContain("2 张图片");
    expect(importPreviewLabel([], 3)).toBe("将导入 3 张图片");
  });
});

describe("uniquePath for import conflicts", () => {
  it("does not silently overwrite existing asset paths", () => {
    const existing = new Set(["笔记/树/figs/01.png", "笔记/树/note.md"]);
    expect(uniquePath("笔记/树/figs/01.png", existing)).toBe("笔记/树/figs/01-2.png");
    expect(uniquePath("笔记/树/figs/02.png", existing)).toBe("笔记/树/figs/02.png");
  });
});
