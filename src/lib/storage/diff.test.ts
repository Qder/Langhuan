import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("marks additions and deletions", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc");
    const types = d.map((x) => x.type);
    expect(types).toContain("del");
    expect(types).toContain("add");
    expect(d.filter((x) => x.type === "same").map((x) => x.text)).toEqual(["a", "c"]);
  });

  it("handles identical", () => {
    const d = diffLines("hello", "hello");
    expect(d).toEqual([{ type: "same", text: "hello", oldLine: 1, newLine: 1 }]);
  });
});
