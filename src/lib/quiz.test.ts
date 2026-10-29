import { describe, expect, it } from "vitest";
import {
  buildQuizReviewList,
  countDetailsTags,
  detectQuizHtml,
  extractQuizDetails,
  mergeQuizItems,
  reviewBadgeCount,
  setQuizItemState,
  syncQuizDocFromSource,
  type QuizDoc,
  type QuizItem,
} from "./quiz";

const QUIZ_TWO = `<!DOCTYPE html><html><body>
<details><summary>题1</summary><p>答1</p></details>
<details><summary>题2</summary><p>答2</p></details>
</body></html>`;

const QUIZ_ONE_HINT = `<!DOCTYPE html><html><body>
<details open>
  <summary>题干：What is 2+2?</summary>
  <div class="answer">答案：4</div>
</details>
</body></html>`;

const PLAIN_HTML = `<!DOCTYPE html><html><body>
<p>Hello</p>
<details><summary>More info</summary><p>Extra</p></details>
</body></html>`;

describe("detectQuizHtml", () => {
  it("detects ≥2 details", () => {
    expect(detectQuizHtml(QUIZ_TWO)).toBe(true);
  });

  it("detects single details with 题/答案 hint", () => {
    expect(detectQuizHtml(QUIZ_ONE_HINT)).toBe(true);
  });

  it("rejects plain HTML with one non-quiz details", () => {
    expect(detectQuizHtml(PLAIN_HTML)).toBe(false);
  });

  it("rejects HTML with no details", () => {
    expect(detectQuizHtml("<p>hi</p>")).toBe(false);
  });

  it("forceQuiz overrides negative heuristic", () => {
    expect(detectQuizHtml(PLAIN_HTML, { forceQuiz: true })).toBe(true);
  });
});

describe("extractQuizDetails + id stability", () => {
  it("assigns start-end ids", () => {
    const items = extractQuizDetails(QUIZ_ONE_HINT);
    expect(items.length).toBe(1);
    expect(items[0].id).toMatch(/^\d+-\d+$/);
    expect(items[0].stem).toContain("题干");
  });

  it("keeps same id when whitespace outside details changes", () => {
    const a = extractQuizDetails(QUIZ_ONE_HINT);
    const tweaked =
      QUIZ_ONE_HINT.replace("</body>", "\n\n  \n</body>") + "\n";
    // Only trailing / outside-details whitespace — details offsets stay if
    // we only append after </details>. Append before </body>:
    const b = extractQuizDetails(tweaked);
    expect(b[0].id).toBe(a[0].id);
    expect(b[0].stem).toBe(a[0].stem);
  });

  it("countDetailsTags matches extract length for simple pages", () => {
    expect(countDetailsTags(QUIZ_TWO)).toBe(2);
    expect(extractQuizDetails(QUIZ_TWO)).toHaveLength(2);
  });
});

describe("mergeQuizItems rematch", () => {
  it("preserves state by id", () => {
    const extracted = extractQuizDetails(QUIZ_TWO);
    const prev: QuizItem[] = [
      {
        id: extracted[0].id,
        stem: extracted[0].stem,
        state: "dont_know",
        updatedAt: 1,
      },
    ];
    const merged = mergeQuizItems(extracted, prev, 99);
    expect(merged[0].state).toBe("dont_know");
    expect(merged[1].state).toBe("unseen");
  });

  it("falls back to stem when id drifts", () => {
    const extracted = extractQuizDetails(QUIZ_TWO);
    const prev: QuizItem[] = [
      {
        id: "0-1",
        stem: extracted[1].stem,
        state: "know",
        updatedAt: 1,
      },
    ];
    const merged = mergeQuizItems(extracted, prev, 99);
    expect(merged[1].state).toBe("know");
    expect(merged[1].id).toBe(extracted[1].id);
  });
});

describe("setQuizItemState", () => {
  it("does not downgrade know/dont_know to peeked", () => {
    const doc: QuizDoc = {
      docId: "d1",
      updatedAt: 1,
      items: [
        { id: "1-2", stem: "q", state: "know", updatedAt: 1 },
      ],
    };
    const next = setQuizItemState(doc, "1-2", "peeked", 5);
    expect(next.items[0].state).toBe("know");
  });

  it("allows explicit know after peeked", () => {
    const doc: QuizDoc = {
      docId: "d1",
      updatedAt: 1,
      items: [
        { id: "1-2", stem: "q", state: "peeked", updatedAt: 1 },
      ],
    };
    expect(setQuizItemState(doc, "1-2", "dont_know").items[0].state).toBe(
      "dont_know"
    );
  });
});

describe("review list hides trashed docs", () => {
  it("omits items whose docId is not live", () => {
    const quizDocs: QuizDoc[] = [
      {
        docId: "alive",
        updatedAt: 1,
        items: [
          { id: "1-2", stem: "a", state: "dont_know", updatedAt: 1 },
          { id: "3-4", stem: "b", state: "unseen", updatedAt: 1 },
        ],
      },
      {
        docId: "trashed",
        updatedAt: 1,
        items: [
          { id: "5-6", stem: "c", state: "dont_know", updatedAt: 1 },
        ],
      },
    ];
    const live = new Set(["alive"]);
    const list = buildQuizReviewList(quizDocs, live);
    expect(list.map((e) => e.docId)).toEqual(["alive", "alive"]);
    expect(reviewBadgeCount(quizDocs, live)).toEqual({
      dontKnow: 1,
      unseen: 1,
    });
    expect(reviewBadgeCount(quizDocs, live)).not.toEqual({
      dontKnow: 2,
      unseen: 1,
    });
  });
});

describe("syncQuizDocFromSource", () => {
  it("returns null for non-quiz html", () => {
    expect(syncQuizDocFromSource("x", PLAIN_HTML, undefined)).toBeNull();
  });

  it("keeps forceQuiz doc even if heuristic fails", () => {
    const prev: QuizDoc = {
      docId: "x",
      forceQuiz: true,
      updatedAt: 1,
      items: [{ id: "1-2", stem: "More info", state: "know", updatedAt: 1 }],
    };
    const synced = syncQuizDocFromSource("x", PLAIN_HTML, prev, 9);
    expect(synced).not.toBeNull();
    expect(synced!.forceQuiz).toBe(true);
  });
});
