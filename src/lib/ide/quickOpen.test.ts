import { describe, expect, it } from "vitest";
import { filterQuickOpenPaths, planQuickOpenCandidates } from "./quickOpen";

describe("filterQuickOpenPaths", () => {
  it("filter foo hits src/Foo.java", () => {
    expect(
      filterQuickOpenPaths(
        ["src/Foo.java", "src/main/java/com/demo/Bar.java", "README.md"],
        "foo"
      )
    ).toEqual(["src/Foo.java"]);
  });

  it("java.util does not match a file from package name alone", () => {
    expect(
      filterQuickOpenPaths(["src/Foo.java", "src/ListHelper.java"], "java.util")
    ).toEqual([]);
  });

  it("matches full relative path segments", () => {
    expect(
      filterQuickOpenPaths(
        ["src/main/java/com/demo/Foo.java", "src/Foo.java"],
        "com/demo"
      )
    ).toEqual(["src/main/java/com/demo/Foo.java"]);
  });
});

describe("planQuickOpenCandidates", () => {
  it("empty query lists current tabs, not blank", () => {
    expect(
      planQuickOpenCandidates({
        query: "",
        fileIndex: ["src/A.java", "src/B.java"],
        tabPaths: ["src/B.java", "src/A.java"],
      })
    ).toEqual(["src/B.java", "src/A.java"]);
  });

  it("non-empty query filters fileIndex", () => {
    expect(
      planQuickOpenCandidates({
        query: "foo",
        fileIndex: ["src/Foo.java", "src/Bar.java"],
        tabPaths: ["src/Bar.java"],
      })
    ).toEqual(["src/Foo.java"]);
  });
});
