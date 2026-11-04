import { describe, expect, it } from "vitest";
import { backlinkEqualityKey, excerptAround, listBacklinkHits } from "./search";
import type { Document } from "./types";

function md(partial: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: "md",
    starred: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("listBacklinkHits", () => {
  it("returns one hit per [[current]] with offsets on [[ and ~80-char excerpts", () => {
    const a = md({
      id: "a",
      path: "a.md",
      content: "开头填充文字看看摘录。第一次见 [[b]] 中间还有话。第二次再提 [[b]] 收尾。",
    });
    const c = md({
      id: "c",
      path: "folder/c.md",
      content: "只有一处指向 [[b]]。",
    });
    const lonely = md({
      id: "lonely",
      path: "lonely.md",
      content: "没有指向 b，只有 [[lonely]]。",
    });
    const b = md({ id: "b", path: "b.md", content: "# b\n" });
    const html = {
      ...md({ id: "h", path: "h.html", content: "[[b]]" }),
      type: "html" as const,
    };

    const hits = listBacklinkHits([a, b, c, lonely, html], b);
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.docId).sort()).toEqual(["a", "a", "c"]);
    for (const h of hits) {
      const doc = [a, c].find((d) => d.id === h.docId)!;
      expect(doc.content.slice(h.start, h.start + 2)).toBe("[[");
      expect(doc.content.slice(h.start, h.end)).toMatch(/^\[\[[^\]]+\]\]$/);
      expect(h.excerpt.length).toBeLessThanOrEqual(90);
      expect(h.excerpt).toContain("[[b]]");
      expect(h.path).toBe(doc.path);
    }
    // lonely + html contribute nothing; self-link on lonely ignored for b
    expect(hits.every((h) => h.docId !== "lonely" && h.docId !== "h")).toBe(true);
  });

  it("skips unresolved and self-links", () => {
    const b = md({ id: "b", path: "b.md", content: "自链 [[b]] 与幽灵 [[ghost]]" });
    const a = md({ id: "a", path: "a.md", content: "[[ghost]] 和 [[b]]" });
    const hits = listBacklinkHits([a, b], b);
    expect(hits).toHaveLength(1);
    expect(hits[0].docId).toBe("a");
    expect(a.content.slice(hits[0].start, hits[0].end)).toBe("[[b]]");
  });
});

describe("excerptAround", () => {
  it("keeps core and caps length", () => {
    const s = "一二三四五六七八九十".repeat(5) + "[[b]]" + "甲乙丙丁戊己庚辛壬癸".repeat(5);
    const start = s.indexOf("[[b]]");
    const end = start + 5;
    const ex = excerptAround(s, start, end, 80);
    expect(ex).toContain("[[b]]");
    expect(ex.length).toBeLessThanOrEqual(82);
  });
});

describe("backlinkEqualityKey", () => {
  it("is Object.is-stable across identical getSnapshot-style calls", () => {
    const a = md({ id: "a", path: "a.md", content: "see [[b]]", updatedAt: 10 });
    const b = md({ id: "b", path: "b.md", content: "# b", updatedAt: 11 });
    const c = md({ id: "c", path: "c.md", content: "nope", updatedAt: 12 });
    const docs = [a, b, c];
    const k1 = backlinkEqualityKey(docs, b);
    const k2 = backlinkEqualityKey(docs, b);
    expect(k1).toBe(k2);
    expect(Object.is(k1, k2)).toBe(true);
    // Unrelated doc content/time change that is not a backlink must not share identity
    // with a real backlink change — key includes only target + backlink docs.
    const docs2 = [a, b, { ...c, content: "still nope", updatedAt: 99 }];
    expect(backlinkEqualityKey(docs2, b)).toBe(k1);
    const docs3 = [{ ...a, content: "see [[b]] again", updatedAt: 20 }, b, c];
    expect(backlinkEqualityKey(docs3, b)).not.toBe(k1);
  });
});
