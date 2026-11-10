import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "./HomeView.tsx"), "utf8");

describe("HomeView home surface", () => {
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

  it("lists 学习专题 from stored topics, with a real create/open path", () => {
    expect(src).toContain("学习专题");
    expect(src).toContain("learningTopics");
    expect(src).toContain("createLearningTopic");
    expect(src).toContain("setActiveTopicId");
    expect(src).toContain("topicSummary");
    expect(src).toContain("还没有专题");
    expect(src).not.toContain("学习专题即将推出");
  });
});
