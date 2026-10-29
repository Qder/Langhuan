import { describe, expect, it } from "vitest";
import { charBigrams, tokenize } from "./tokenize";

describe("tokenize", () => {
  it("tokenizes English words", () => {
    expect(tokenize("Binary Search")).toEqual(expect.arrayContaining(["binary", "search"]));
  });

  it("tokenizes CJK via segmenter or fallback", () => {
    const t = tokenize("双链笔记");
    expect(t.length).toBeGreaterThan(0);
    expect(t.join("")).toMatch(/双|链|笔|记/);
  });

  it("fallback unigram+bigram", () => {
    const t = tokenize("双链", { forceFallback: true });
    expect(t).toEqual(expect.arrayContaining(["双", "链", "双链"]));
  });

  it("mixed CJK + EN", () => {
    const t = tokenize("React 钩子");
    expect(t.join(" ")).toMatch(/react/i);
  });
});

describe("charBigrams", () => {
  it("builds adjacent pairs", () => {
    expect(charBigrams("abcd")).toEqual(["ab", "bc", "cd"]);
  });
});
