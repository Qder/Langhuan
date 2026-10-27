import { describe, expect, it } from "vitest";
import {
  buildTree,
  isPathUnderFolder,
  joinFolderPath,
  normalizeFolderPath,
  parentFolderForNew,
  pruneEmptyFolders,
  removeFolderAndDescendants,
  sanitizeFolderSegment,
} from "./folders";

describe("sanitizeFolderSegment", () => {
  it("accepts normal names", () => {
    expect(sanitizeFolderSegment("笔记")).toBe("笔记");
    expect(sanitizeFolderSegment("  algo  ")).toBe("algo");
  });

  it("rejects empty, slash, dot, and control chars", () => {
    expect(sanitizeFolderSegment("")).toBeNull();
    expect(sanitizeFolderSegment("   ")).toBeNull();
    expect(sanitizeFolderSegment(".")).toBeNull();
    expect(sanitizeFolderSegment("..")).toBeNull();
    expect(sanitizeFolderSegment("a/b")).toBeNull();
    expect(sanitizeFolderSegment("a\\b")).toBeNull();
    expect(sanitizeFolderSegment("a\nb")).toBeNull();
  });
});

describe("normalizeFolderPath / joinFolderPath", () => {
  it("normalizes slashes and drops . / ..", () => {
    expect(normalizeFolderPath("/笔记/算法/")).toBe("笔记/算法");
    expect(normalizeFolderPath("a/./b/../c")).toBe("a/b/c");
  });

  it("joins parent + segment", () => {
    expect(joinFolderPath("", "笔记")).toBe("笔记");
    expect(joinFolderPath("笔记", "算法")).toBe("笔记/算法");
    expect(joinFolderPath("笔记", "a/b")).toBe("");
  });
});

describe("buildTree empty folders", () => {
  it("merges empty folder paths into the tree", () => {
    const tree = buildTree(
      [{ id: "1", path: "已有/a.md", type: "md" }],
      ["空夹", "已有/子空夹"]
    );
    expect(tree.children.has("空夹")).toBe(true);
    expect(tree.children.get("空夹")!.docs).toEqual([]);
    expect(tree.children.get("已有")!.children.has("子空夹")).toBe(true);
    expect(tree.children.get("已有")!.docs.map((d) => d.name)).toEqual(["a.md"]);
  });
});

describe("pruneEmptyFolders", () => {
  it("removes folders that now contain documents", () => {
    expect(
      pruneEmptyFolders(["笔记", "笔记/空", "独立空"], ["笔记/foo.md"])
    ).toEqual(["笔记/空", "独立空"]);
  });
});

describe("parentFolderForNew", () => {
  it("uses dirname of active doc or root", () => {
    expect(parentFolderForNew(null)).toBe("");
    expect(parentFolderForNew("a.md")).toBe("");
    expect(parentFolderForNew("笔记/算法/spfa.md")).toBe("笔记/算法");
  });
});

describe("isPathUnderFolder", () => {
  it("matches descendants only; root never matches", () => {
    expect(isPathUnderFolder("笔记/a.md", "笔记")).toBe(true);
    expect(isPathUnderFolder("笔记/子/b.md", "笔记")).toBe(true);
    expect(isPathUnderFolder("笔记.md", "笔记")).toBe(false);
    expect(isPathUnderFolder("其他/a.md", "笔记")).toBe(false);
    expect(isPathUnderFolder("笔记/a.md", "")).toBe(false);
  });
});

describe("removeFolderAndDescendants", () => {
  it("drops the folder and nested empty entries", () => {
    expect(
      removeFolderAndDescendants(
        ["笔记", "笔记/空", "笔记/空/更深", "独立空"],
        "笔记"
      )
    ).toEqual(["独立空"]);
  });

  it("leaves list alone for root path", () => {
    expect(removeFolderAndDescendants(["a", "b"], "")).toEqual(["a", "b"]);
  });
});
