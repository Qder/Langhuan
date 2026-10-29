import { describe, expect, it } from "vitest";
import { classifyMatch, scoreDocumentRanked } from "./rank";
import type { SearchField } from "./index";

describe("classifyMatch", () => {
  it("detects exact / prefix / substring", () => {
    expect(classifyMatch("binary search", "binary")?.quality).toBe("exact");
    expect(classifyMatch("binarysearch", "binary")?.quality).toBe("prefix");
    expect(classifyMatch("xbinaryy", "binary")?.quality).toBe("substring");
  });
});

describe("scoreDocumentRanked", () => {
  const empty: Record<SearchField, string> = {
    title: "",
    aliases: "",
    path: "",
    tags: "",
    body: "",
  };

  it("title hit outranks body-only", () => {
    const titleHit = scoreDocumentRanked({ ...empty, title: "双链笔记" }, ["双链"], 0);
    const bodyHit = scoreDocumentRanked({ ...empty, body: "提到双链" }, ["双链"], 0);
    expect(titleHit).toBeGreaterThan(bodyHit);
  });

  it("tags outrank path", () => {
    const tagHit = scoreDocumentRanked({ ...empty, tags: "验收" }, ["验收"], 0);
    const pathHit = scoreDocumentRanked({ ...empty, path: "页面/验收.md" }, ["验收"], 0);
    expect(tagHit).toBeGreaterThan(pathHit);
  });

  it("recency cannot overturn a title gap", () => {
    const oldTitle = scoreDocumentRanked({ ...empty, title: "双链" }, ["双链"], 0);
    const freshBody = scoreDocumentRanked(
      { ...empty, body: "双链" },
      ["双链"],
      Date.now()
    );
    expect(oldTitle).toBeGreaterThan(freshBody);
  });
});
