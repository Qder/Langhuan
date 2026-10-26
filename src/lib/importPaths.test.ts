import { describe, expect, it } from "vitest";
import { collectFolders, rewriteImportPaths } from "./importPaths";

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
});
