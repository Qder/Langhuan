import { describe, expect, it, beforeEach } from "vitest";
import type { Document } from "../types";
import { SearchIndex } from "./index";
import { buildSearchIndexSync, resetSearchIndexForTests } from "./runtime";
import { searchWithIndex } from "./queryEngine";
import { searchDocumentsLegacy } from "./legacy";
import { BASELINE_DOCS } from "./__fixtures__/baselineDocs";
import { BASELINE_RECALL } from "./__fixtures__/baselineRecall";

function doc(p: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: "md",
    starred: false,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

describe("SearchIndex incremental", () => {
  beforeEach(() => resetSearchIndexForTests());

  it("upsert / remove / rename path", () => {
    const idx = new SearchIndex();
    idx.upsert(doc({ id: "a", path: "old.md", content: "alpha beta" }));
    expect(idx.candidatesForTerm("alpha").has("a")).toBe(true);
    idx.upsert(doc({ id: "a", path: "new.md", content: "alpha gamma", updatedAt: 2 }));
    expect(idx.getDoc("a")?.path).toBe("new.md");
    expect(idx.candidatesForTerm("gamma").has("a")).toBe(true);
    expect(idx.candidatesForTerm("beta").has("a")).toBe(false);
    idx.remove("a");
    expect(idx.size).toBe(0);
  });
});

describe("index recall ⊇ legacy baseline", () => {
  beforeEach(() => resetSearchIndexForTests());

  it("every baseline id is found via searchWithIndex", () => {
    const idx = buildSearchIndexSync(BASELINE_DOCS);
    for (const [q, ids] of Object.entries(BASELINE_RECALL)) {
      const hits = searchWithIndex(idx, BASELINE_DOCS, q);
      const got = new Set(hits.map((h) => h.id));
      for (const id of ids) {
        expect(got.has(id), `index missing ${id} for ${JSON.stringify(q)}`).toBe(true);
      }
      // Also ⊆ relative to live legacy
      const legacy = new Set(searchDocumentsLegacy(BASELINE_DOCS, q).map((h) => h.id));
      for (const id of legacy) {
        expect(got.has(id), `index lost legacy hit ${id} for ${JSON.stringify(q)}`).toBe(true);
      }
    }
  });
});
