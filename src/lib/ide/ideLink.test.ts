import { describe, expect, it } from "vitest";
import {
  formatIdeLink,
  ideLinkLabel,
  isIdeLinkTarget,
  parseIdeLinkTarget,
} from "./ideLink";

describe("isIdeLinkTarget", () => {
  it("accepts ide: and ide:// targets only", () => {
    expect(isIdeLinkTarget("ide:src/a.ts")).toBe(true);
    expect(isIdeLinkTarget("ide://src/a.ts")).toBe(true);
    expect(isIdeLinkTarget(" IDE:src/a.ts ")).toBe(true);
    expect(isIdeLinkTarget("src/a.ts")).toBe(false);
    expect(isIdeLinkTarget("ides:src/a.ts")).toBe(false);
    expect(isIdeLinkTarget("")).toBe(false);
    expect(isIdeLinkTarget(null)).toBe(false);
  });
});

describe("parseIdeLinkTarget", () => {
  it("parses a bare path", () => {
    expect(parseIdeLinkTarget("ide:src/lib/a.ts")).toEqual({
      path: "src/lib/a.ts",
    });
  });

  it("parses a single line and a range", () => {
    expect(parseIdeLinkTarget("ide:src/a.ts:12")).toEqual({
      path: "src/a.ts",
      line: 12,
    });
    expect(parseIdeLinkTarget("ide:src/a.ts:12-20")).toEqual({
      path: "src/a.ts",
      line: 12,
      endLine: 20,
    });
  });

  it("accepts ide:// with a #L hash fragment", () => {
    expect(parseIdeLinkTarget("ide://src/a.java#L7-L9")).toEqual({
      path: "src/a.java",
      line: 7,
      endLine: 9,
    });
  });

  it("normalizes backslashes and leading ./", () => {
    expect(parseIdeLinkTarget("ide:.\\src\\Foo.java:3")).toEqual({
      path: "src/Foo.java",
      line: 3,
    });
  });

  it("ignores a backwards range and non-numeric suffixes", () => {
    expect(parseIdeLinkTarget("ide:src/a.ts:20-12")).toEqual({
      path: "src/a.ts",
      line: 20,
    });
    // `:abc` is not a line suffix, and `a.ts:abc` is not a text path → reject.
    expect(parseIdeLinkTarget("ide:src/a.ts:abc")).toBeNull();
  });

  it("rejects empty, foreign schemes, and non-file tokens", () => {
    expect(parseIdeLinkTarget("")).toBeNull();
    expect(parseIdeLinkTarget("src/a.ts:1")).toBeNull();
    expect(parseIdeLinkTarget("ide:")).toBeNull();
    expect(parseIdeLinkTarget("ide:ide:")).toBeNull();
  });
});

describe("formatIdeLink", () => {
  it("round-trips through the parser", () => {
    const link = formatIdeLink("src/foo/Bar.java", 12, 20);
    expect(link).toBe("[[ide:src/foo/Bar.java:12-20]]");
    const inner = link.slice(2, -2);
    expect(parseIdeLinkTarget(inner)).toEqual({
      path: "src/foo/Bar.java",
      line: 12,
      endLine: 20,
    });
  });

  it("omits line info when absent and normalizes the path", () => {
    expect(formatIdeLink("\\src\\a.ts")).toBe("[[ide:src/a.ts]]");
  });

  it("drops a non-advancing end line", () => {
    expect(formatIdeLink("src/a.ts", 5, 5)).toBe("[[ide:src/a.ts:5]]");
    expect(formatIdeLink("src/a.ts", 5, 2)).toBe("[[ide:src/a.ts:5]]");
  });
});

describe("ideLinkLabel", () => {
  it("renders path and range", () => {
    expect(ideLinkLabel({ path: "src/a.ts", line: 4 })).toBe("src/a.ts:4");
    expect(ideLinkLabel({ path: "src/a.ts", line: 4, endLine: 9 })).toBe(
      "src/a.ts:4-9"
    );
    expect(ideLinkLabel({ path: "src/a.ts" })).toBe("src/a.ts");
  });

  it("ellipsizes long paths from the left", () => {
    const long = `src/${"a".repeat(60)}/file.ts`;
    const label = ideLinkLabel({ path: long }, 20);
    expect(label.startsWith("…")).toBe(true);
    expect(label.endsWith("file.ts")).toBe(true);
  });
});
