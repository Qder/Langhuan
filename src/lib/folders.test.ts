import { describe, expect, it } from "vitest";
import {
  buildTree,
  folderExists,
  isPathUnderFolder,
  joinFolderPath,
  listFolderPaths,
  normalizeFolderPath,
  parentFolderForNew,
  parseFolderInput,
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

describe("parseFolderInput", () => {
  const cases: {
    raw: string;
    parent?: string;
    ok: boolean;
    fullPath?: string;
    segments?: string[];
  }[] = [
    { raw: "算法/图论", ok: true, fullPath: "算法/图论", segments: ["算法", "图论"] },
    { raw: "/算法/图论", ok: true, fullPath: "算法/图论", segments: ["算法", "图论"] },
    { raw: "算法/", ok: true, fullPath: "算法", segments: ["算法"] },
    { raw: "  算法/图论  ", ok: true, fullPath: "算法/图论", segments: ["算法", "图论"] },
    { raw: "算法\\图论", ok: true, fullPath: "算法/图论", segments: ["算法", "图论"] },
    { raw: "a//b", ok: false },
    { raw: ".", ok: false },
    { raw: "..", ok: false },
    { raw: "a/../b", ok: false },
    { raw: "", ok: false },
    { raw: "   ", ok: false },
    { raw: "图论", parent: "算法", ok: true, fullPath: "算法/图论", segments: ["图论"] },
    { raw: "子/孙", parent: "算法", ok: true, fullPath: "算法/子/孙", segments: ["子", "孙"] },
    {
      raw: "/绝对/路径",
      parent: "算法",
      ok: true,
      fullPath: "绝对/路径",
      segments: ["绝对", "路径"],
    },
  ];

  it.each(cases)("parse %# $raw parent=$parent", ({ raw, parent, ok, fullPath, segments }) => {
    const r = parseFolderInput(raw, parent ?? "");
    expect(r.ok).toBe(ok);
    if (ok && r.ok) {
      expect(r.fullPath).toBe(fullPath);
      expect(r.segments).toEqual(segments);
    } else if (!ok && !r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("listFolderPaths / folderExists", () => {
  it("lists folders from docs and emptyFolders", () => {
    expect(
      listFolderPaths([{ path: "已有/a.md" }], ["空夹", "已有/子空夹"])
    ).toEqual(["空夹", "已有", "已有/子空夹"]);
  });

  it("folderExists covers docs and empty entries", () => {
    expect(folderExists("已有", ["已有/a.md"], [])).toBe(true);
    expect(folderExists("空夹", [], ["空夹"])).toBe(true);
    expect(folderExists("没有", [], [])).toBe(false);
    expect(folderExists("", [], [])).toBe(true);
  });
});
