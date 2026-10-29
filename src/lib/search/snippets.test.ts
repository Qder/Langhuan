import { describe, expect, it } from "vitest";
import { buildSnippet } from "./snippets";

describe("buildSnippet", () => {
  it("uses ~40 codepoint radius and marks the hit", () => {
    const body = "前".repeat(50) + "目标词" + "后".repeat(50);
    const { text, marks } = buildSnippet(body, ["目标词"], 40);
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(marks.length).toBeGreaterThan(0);
    const marked = [...text].slice(marks[0].start, marks[0].end).join("");
    expect(marked).toBe("目标词");
  });

  it("does not split emoji codepoints", () => {
    const body = "火箭🚀发射成功";
    const { text, marks } = buildSnippet(body, ["🚀"], 10);
    expect(text).toContain("🚀");
    if (marks[0]) {
      const slice = [...text].slice(marks[0].start, marks[0].end).join("");
      expect(slice).toBe("🚀");
    }
  });

  it("handles miss with prefix slice", () => {
    const { text, marks } = buildSnippet("abcdefghij", ["zzz"], 3);
    expect(marks).toEqual([]);
    expect(text.length).toBeGreaterThan(0);
  });
});
