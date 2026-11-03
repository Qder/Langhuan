import { describe, expect, it } from "vitest";
import {
  describeFindHit,
  findInFileMatches,
  stepFindIndex,
} from "./findInFile";

describe("findInFile", () => {
  it("finds literal matches case-insensitively by default", () => {
    const hits = findInFileMatches("Foo bar foo", "foo");
    expect(hits).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("respects caseSensitive", () => {
    const hits = findInFileMatches("Foo foo", "Foo", { caseSensitive: true });
    expect(hits).toEqual([{ start: 0, end: 3 }]);
  });

  it("steps wrap around", () => {
    expect(stepFindIndex(-1, 3, 1)).toBe(0);
    expect(stepFindIndex(2, 3, 1)).toBe(0);
    expect(stepFindIndex(0, 3, -1)).toBe(2);
    expect(stepFindIndex(0, 0, 1)).toBe(-1);
  });

  it("describeFindHit reports 1-based index and line", () => {
    const content = "a\nfind me\nc";
    const hits = findInFileMatches(content, "find");
    expect(hits).toHaveLength(1);
    const d = describeFindHit(content, hits[0]!, 0, 1);
    expect(d.line).toBe(2);
    expect(d.message).toContain("1/1");
    expect(d.message).toContain("第 2 行");
  });
});
