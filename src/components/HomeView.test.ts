import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "./HomeView.tsx"), "utf8");

describe("HomeView Step 5 surface", () => {
  it("has a 继续阅读 entry driven by last-read progress, not only updatedAt", () => {
    expect(src).toContain("继续阅读");
    expect(src).toContain("pickContinueReading");
    expect(src).toContain("readScrollMemoryMap");
    expect(src).toContain("subscribeReadingProgress");
  });

  it("keeps an honest 最近编辑 list by updatedAt", () => {
    expect(src).toContain("最近编辑");
    expect(src).toContain("recentNotesByUpdatedAt");
  });

  it("does not add a 学习专题 homepage entry", () => {
    expect(src).not.toContain("学习专题");
  });
});
