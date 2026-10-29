import { describe, expect, it, beforeEach } from "vitest";
import { searchDocuments, buildSearchIndexSync, resetSearchIndexForTests } from "../search";
import { BASELINE_DOCS } from "./__fixtures__/baselineDocs";

describe("query syntax integration", () => {
  beforeEach(() => {
    resetSearchIndexForTests();
    buildSearchIndexSync(BASELINE_DOCS);
  });

  it("title: restricts to title/alias matches", () => {
    const hits = searchDocuments(BASELINE_DOCS, "title:双链");
    expect(hits.map((h) => h.id)).toContain("cn-title");
    expect(hits.map((h) => h.id)).not.toContain("html-page");
  });

  it("phrase requires contiguous match", () => {
    const hits = searchDocuments(BASELINE_DOCS, '"binary search"');
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("en-body");
    expect(ids).toContain("body-only-hit");
  });

  it("-exclude drops matching docs", () => {
    const all = searchDocuments(BASELINE_DOCS, "双链");
    expect(all.map((h) => h.id)).toContain("html-page");
    const filtered = searchDocuments(BASELINE_DOCS, "双链 -清单");
    // html-page body has 清单; should be excluded
    expect(filtered.map((h) => h.id)).not.toContain("html-page");
    expect(filtered.map((h) => h.id)).toContain("cn-title");
  });
});
