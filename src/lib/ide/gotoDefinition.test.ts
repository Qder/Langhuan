import { describe, expect, it } from "vitest";
import {
  findDefinitionLine,
  isGotoDefinitionIdentifier,
  planGotoDefinition,
  wordAtOffset,
} from "./gotoDefinition";

describe("isGotoDefinitionIdentifier", () => {
  it("rejects keywords", () => {
    expect(isGotoDefinitionIdentifier("class")).toBe(false);
    expect(isGotoDefinitionIdentifier("if")).toBe(false);
    expect(isGotoDefinitionIdentifier("import")).toBe(false);
    expect(isGotoDefinitionIdentifier("public")).toBe(false);
  });

  it("accepts Foo", () => {
    expect(isGotoDefinitionIdentifier("Foo")).toBe(true);
  });
});

describe("planGotoDefinition", () => {
  it("opens unique src/Foo.java for word Foo", () => {
    expect(
      planGotoDefinition({
        word: "Foo",
        currentPath: "src/A.java",
        fileIndex: ["src/A.java", "src/Foo.java"],
      })
    ).toEqual({ kind: "open", path: "src/Foo.java" });
  });

  it("returns candidates when two Foo.java", () => {
    const plan = planGotoDefinition({
      word: "Foo",
      currentPath: "src/A.java",
      fileIndex: ["a/Foo.java", "b/Foo.java"],
    });
    expect(plan.kind).toBe("candidates");
    if (plan.kind === "candidates") {
      expect(plan.candidates).toEqual(["a/Foo.java", "b/Foo.java"]);
    }
  });

  it("misses List when no List.java", () => {
    expect(
      planGotoDefinition({
        word: "List",
        currentPath: "src/A.java",
        fileIndex: ["src/A.java", "src/Foo.java"],
      })
    ).toEqual({ kind: "miss" });
  });
});

describe("findDefinitionLine", () => {
  it("finds class Foo line", () => {
    const content = "package x;\n\npublic class Foo {\n}\n";
    expect(findDefinitionLine(content, "Foo")).toBe(3);
  });

  it("defaults to 1 when no match", () => {
    expect(findDefinitionLine("int x = 1;\n", "Foo")).toBe(1);
  });
});

describe("wordAtOffset", () => {
  it("reads identifier under cursor", () => {
    expect(wordAtOffset("  Foo bar", 2)).toBe("Foo");
    expect(wordAtOffset("import Foo;", 8)).toBe("Foo");
  });
});
