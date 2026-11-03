import { describe, expect, it } from "vitest";
import { parseGotoLine } from "./gotoLine";

describe("parseGotoLine", () => {
  it('parses "42" → line 42', () => {
    expect(parseGotoLine("42")).toEqual({ line: 42 });
  });

  it('parses "42:8" → at least line 42', () => {
    expect(parseGotoLine("42:8")).toEqual({ line: 42, column: 8 });
  });

  it('rejects "0"', () => {
    expect(parseGotoLine("0")).toBeNull();
  });

  it('rejects "abc"', () => {
    expect(parseGotoLine("abc")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseGotoLine("  12  ")).toEqual({ line: 12 });
  });
});
