import { describe, expect, it } from "vitest";
import { searchDocuments } from "../search";
import { BASELINE_DOCS } from "./__fixtures__/baselineDocs";

/**
 * Frozen recall sets from the pre-index implementation (search.ts substring scorer).
 * After the index/ranking refactor, every listed id MUST still appear (old ⊆ new).
 * Ordering may change; soft rank checks below stay valid under title>body weighting.
 */
export const BASELINE_RECALL: Record<string, string[]> = {
  "": [],
  "   ": [],
  双链: ["cn-title", "html-page"],
  双链笔记: ["cn-title", "html-page"],
  "binary search": ["body-only-hit", "en-body"],
  "Binary Search": ["body-only-hit", "en-body"],
  useState: ["mixed"],
  hello: ["code-fence"],
  验收: ["html-page", "cn-title"],
  "tag:验收": ["cn-title", "html-page"],
  "tag:验收 双链": ["cn-title", "html-page"],
  "path:页面/": ["html-page"],
  "type:html": ["html-page"],
  "type:md binary": ["body-only-hit", "en-body"],
  UniqueNeedle: ["long-doc"],
  "🚀": [],
  相关性排序: ["path-deep"],
  "hidden-token": [],
  knowledge: [],
  Zettel: ["cn-title"],
  "!!!": [],
  "前端 React": ["mixed"],
  天气预报: ["fm-only-tags"],
};

describe("search baseline recall", () => {
  for (const [q, expectedIds] of Object.entries(BASELINE_RECALL)) {
    it(`recall for ${JSON.stringify(q)} includes frozen ids`, () => {
      const hits = searchDocuments(BASELINE_DOCS, q);
      const got = new Set(hits.map((h) => h.id));
      for (const id of expectedIds) {
        expect(got.has(id), `missing baseline id ${id} for query ${JSON.stringify(q)}`).toBe(true);
      }
      // Before refactor: exact set. After: ⊆ only (got may grow). Soft: no drop.
      if (process.env.SEARCH_BASELINE_EXACT === "1") {
        expect([...got].sort()).toEqual([...expectedIds].sort());
      }
    });
  }

  it("empty / whitespace / symbols yield no hits", () => {
    expect(searchDocuments(BASELINE_DOCS, "")).toEqual([]);
    expect(searchDocuments(BASELINE_DOCS, "   ")).toEqual([]);
    expect(searchDocuments(BASELINE_DOCS, "!!!").map((h) => h.id)).toEqual([]);
  });

  it("script contents are not searchable in HTML (stripHtml)", () => {
    expect(searchDocuments(BASELINE_DOCS, "hidden-token").map((h) => h.id)).toEqual([]);
  });

  it("title/path hit ranks above body-only for 双链", () => {
    const hits = searchDocuments(BASELINE_DOCS, "双链");
    const cn = hits.findIndex((h) => h.id === "cn-title");
    const html = hits.findIndex((h) => h.id === "html-page");
    expect(cn).toBeGreaterThanOrEqual(0);
    expect(html).toBeGreaterThanOrEqual(0);
    // cn-title matches title; html-page matches body — title-weighted doc should not lose to body-only.
    expect(cn).toBeLessThan(html);
  });

  it("alias Zettel finds cn-title", () => {
    expect(searchDocuments(BASELINE_DOCS, "Zettel").map((h) => h.id)).toContain("cn-title");
  });

  it("case folding: Binary Search ≡ binary search ids", () => {
    const a = searchDocuments(BASELINE_DOCS, "Binary Search").map((h) => h.id).sort();
    const b = searchDocuments(BASELINE_DOCS, "binary search").map((h) => h.id).sort();
    expect(a).toEqual(b);
  });
});
