import { describe, expect, it } from "vitest";
import type { IdeFsEntry } from "./ideFs";
import {
  buildIdePendingReveal,
  clampIdeLine,
  ideAncestorDirs,
  isIdeCitationPath,
  parseIdeCitations,
  planIdeCitationJump,
  resolveIdeCitation,
} from "./citations";

function tree(files: string[]): Record<string, IdeFsEntry[]> {
  const children: Record<string, IdeFsEntry[]> = { "": [] };
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    const parts = norm.split("/");
    const name = parts[parts.length - 1]!;
    const dir = parts.slice(0, -1).join("/");
    if (!children[dir]) children[dir] = [];
    children[dir].push({ name, path: norm, kind: "file" });
    // also list intermediate dirs lightly
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = acc;
      const seg = parts[i]!;
      acc = acc ? `${acc}/${seg}` : seg;
      if (!children[parent]) children[parent] = [];
      if (!children[parent].some((e) => e.path === acc && e.kind === "directory")) {
        children[parent].push({ name: seg, path: acc, kind: "directory" });
      }
    }
  }
  return children;
}

describe("isIdeCitationPath", () => {
  it("accepts paths with slash or known extension", () => {
    expect(isIdeCitationPath("src/foo/Bar.java")).toBe(true);
    expect(isIdeCitationPath("Tree.java")).toBe(true);
    expect(isIdeCitationPath("readme.md")).toBe(true);
  });

  it("rejects package names and bare identifiers", () => {
    expect(isIdeCitationPath("java.util.List")).toBe(false);
    expect(isIdeCitationPath("Tree")).toBe(false);
  });
});

describe("parseIdeCitations", () => {
  it("parses primary [[path:line]] and range", () => {
    const md =
      "见 [[src/main/java/com/demo/Tree.java:42]] 与 [[src/main/java/com/demo/Tree.java:42-58]]。";
    const hits = parseIdeCitations(md);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      path: "src/main/java/com/demo/Tree.java",
      line: 42,
    });
    expect(hits[1]).toMatchObject({
      path: "src/main/java/com/demo/Tree.java",
      line: 42,
      endLine: 58,
    });
  });

  it("parses fence info path", () => {
    const md = "```java src/main/java/com/demo/Tree.java\nclass T {}\n```";
    const hits = parseIdeCitations(md);
    expect(hits.some((h) => h.path === "src/main/java/com/demo/Tree.java")).toBe(
      true
    );
  });

  it("parses backtick path:line and ide:// link", () => {
    const md =
      "看 `src/foo/Bar.java:12` 以及 [Tree.java](ide://src/main/java/com/demo/Tree.java#L42)。";
    const hits = parseIdeCitations(md);
    expect(hits.map((h) => ({ path: h.path, line: h.line }))).toEqual(
      expect.arrayContaining([
        { path: "src/foo/Bar.java", line: 12 },
        { path: "src/main/java/com/demo/Tree.java", line: 42 },
      ])
    );
  });

  it("negatives: java.util.List and bare Tree", () => {
    const md = "不要点 `java.util.List` 或 [[Tree]] 或 `Tree`。";
    expect(parseIdeCitations(md)).toEqual([]);
  });
});

describe("resolveIdeCitation", () => {
  it("exact relative path", () => {
    const t = tree(["src/A.java", "src/B.java"]);
    expect(resolveIdeCitation("src/A.java", t)).toEqual({
      ok: true,
      path: "src/A.java",
    });
    expect(resolveIdeCitation("./src/A.java", t)).toEqual({
      ok: true,
      path: "src/A.java",
    });
  });

  it("unique basename", () => {
    const t = tree(["src/main/Tree.java", "README.md"]);
    expect(resolveIdeCitation("Tree.java", t)).toEqual({
      ok: true,
      path: "src/main/Tree.java",
    });
  });

  it("two Main.java → candidates", () => {
    const t = tree(["a/Main.java", "b/Main.java"]);
    const r = resolveIdeCitation("Main.java", t);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.candidates.sort()).toEqual(["a/Main.java", "b/Main.java"]);
    }
  });
});

describe("pendingReveal clamp", () => {
  it("1-based and clamps out of bounds", () => {
    expect(clampIdeLine(0, 10)).toBe(1);
    expect(clampIdeLine(99, 10)).toBe(10);
    expect(clampIdeLine(3, 10)).toBe(3);
    expect(buildIdePendingReveal("src/A.java", 100, 200, 12)).toEqual({
      path: "src/A.java",
      line: 12,
      endLine: 12,
    });
    expect(buildIdePendingReveal("src/A.java", 2, 5, 20)).toEqual({
      path: "src/A.java",
      line: 2,
      endLine: 5,
    });
    expect(buildIdePendingReveal("src/A.java", undefined, undefined, 20)).toBeNull();
  });
});

describe("planIdeCitationJump", () => {
  it("unexpanded tree: exact path is try-exact, not miss", () => {
    // Only root listed; src/ never expanded → no files in index
    const t: Record<string, IdeFsEntry[]> = {
      "": [{ name: "src", path: "src", kind: "directory" }],
    };
    expect(planIdeCitationJump("src/A.java", t)).toEqual({
      kind: "try-exact",
      path: "src/A.java",
    });
    expect(planIdeCitationJump("./src/A.java", t)).toEqual({
      kind: "try-exact",
      path: "src/A.java",
    });
  });

  it("exact path already scanned → open", () => {
    const t = tree(["src/A.java"]);
    expect(planIdeCitationJump("src/A.java", t)).toEqual({
      kind: "open",
      path: "src/A.java",
    });
  });

  it("two Main.java basename → candidates", () => {
    const t = tree(["a/Main.java", "b/Main.java"]);
    const r = planIdeCitationJump("Main.java", t);
    expect(r).toEqual({
      kind: "candidates",
      candidates: expect.arrayContaining(["a/Main.java", "b/Main.java"]),
    });
    if (r.kind === "candidates") {
      expect(r.candidates).toHaveLength(2);
    }
  });

  it("java.util.List is miss (not a path)", () => {
    const t = tree(["src/A.java"]);
    expect(planIdeCitationJump("java.util.List", t)).toEqual({
      kind: "miss",
      path: "java.util.List",
    });
  });
});

describe("ideAncestorDirs", () => {
  it("lists parent dirs excluding root and file", () => {
    expect(ideAncestorDirs("src/foo/A.java")).toEqual(["src", "src/foo"]);
    expect(ideAncestorDirs("README.md")).toEqual([]);
  });
});
