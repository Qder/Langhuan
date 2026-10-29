import { describe, expect, it } from "vitest";
import { searchDocuments } from "../search";
import { BASELINE_DOCS } from "./__fixtures__/baselineDocs";
import { BASELINE_RECALL } from "./__fixtures__/baselineRecall";

describe("search baseline recall", () => {
  for (const [q, expectedIds] of Object.entries(BASELINE_RECALL)) {
    it(`recall for ${JSON.stringify(q)} includes frozen ids`, () => {
      const hits = searchDocuments(BASELINE_DOCS, q);
      const got = new Set(hits.map((h) => h.id));
      for (const id of expectedIds) {
        expect(got.has(id), `missing baseline id ${id} for query ${JSON.stringify(q)}`).toBe(true);
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
