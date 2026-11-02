import { describe, expect, it } from "vitest";
import { lineRangeLabel } from "./sourceRangeLabel";

describe("lineRangeLabel", () => {
  const src = "a\nb\nc\nd\n";
  it("single line", () => {
    expect(lineRangeLabel(src, 0, 1).label).toBe("L1");
  });
  it("multi line exclusive end", () => {
    // offsets covering lines 2-3 ("b\nc")
    const start = src.indexOf("b");
    const end = src.indexOf("d");
    expect(lineRangeLabel(src, start, end).label).toBe("L2–L3");
  });
});
