import { describe, expect, it } from "vitest";
import {
  buildQuizReviewList,
  detectQuizHtml,
  reviewBadgeCount,
  type QuizDoc,
} from "./quiz";

describe("quiz review list vs trash", () => {
  const docs: QuizDoc[] = [
    {
      docId: "live",
      updatedAt: 1,
      items: [
        { id: "1-2", stem: "A", state: "dont_know", updatedAt: 1 },
        { id: "3-4", stem: "B", state: "unseen", updatedAt: 1 },
      ],
    },
    {
      docId: "trashed",
      updatedAt: 1,
      items: [{ id: "5-6", stem: "C", state: "dont_know", updatedAt: 1 }],
    },
  ];

  it("hides trashed doc items from review list and badge", () => {
    const live = new Set(["live"]);
    const list = buildQuizReviewList(docs, live);
    expect(list.map((e) => e.docId)).toEqual(["live", "live"]);
    expect(reviewBadgeCount(docs, live)).toEqual({ dontKnow: 1, unseen: 1 });
  });

  it("restores when doc returns to live set", () => {
    const live = new Set(["live", "trashed"]);
    expect(reviewBadgeCount(docs, live).dontKnow).toBe(2);
  });
});

describe("quiz page toolbar gate", () => {
  it("ordinary html without details is not a quiz page", () => {
    expect(detectQuizHtml("<html><body><p>hi</p></body></html>")).toBe(false);
  });

  it("two details is a quiz page", () => {
    const html = "<details><summary>1</summary>a</details><details><summary>2</summary>b</details>";
    expect(detectQuizHtml(html)).toBe(true);
  });

  it("forceQuiz overrides negative detect", () => {
    expect(detectQuizHtml("<p>x</p>", { forceQuiz: true })).toBe(true);
  });
});
