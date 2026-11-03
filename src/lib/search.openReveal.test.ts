import { describe, expect, it } from "vitest";
import { planSearchOpenReveal } from "./search";

describe("planSearchOpenReveal", () => {
  it("points at the first body occurrence when the query appears twice", () => {
    const content = "前言\n琅嬛在左\n中间段落\n琅嬛在右\n";
    const reveal = planSearchOpenReveal(content, "琅嬛");
    expect(reveal).not.toBeNull();
    expect(content.slice(reveal!.start, reveal!.end)).toBe("琅嬛");
    expect(reveal!.start).toBe(content.indexOf("琅嬛"));
    // second occurrence is later
    expect(reveal!.start).toBeLessThan(content.lastIndexOf("琅嬛"));
  });

  it("returns empty reveal when only the title would match (needle absent from body)", () => {
    const content = "这篇笔记只谈目录结构，不出现那个词。\n";
    expect(planSearchOpenReveal(content, "琅嬛")).toBeNull();
  });

  it("is case-insensitive for ASCII", () => {
    const content = "Hello Langhuan world";
    const reveal = planSearchOpenReveal(content, "langhuan");
    expect(reveal).toEqual({ start: 6, end: 14 });
  });
});
