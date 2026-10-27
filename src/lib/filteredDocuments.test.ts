import { describe, expect, it } from "vitest";
import type { Document } from "./types";
import { filteredDocuments } from "./store";

function doc(partial: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: "md",
    starred: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("filteredDocuments AND tag filters", () => {
  const docs: Document[] = [
    doc({
      id: "1",
      path: "a.md",
      content: "---\ntags: [验收, HTML]\n---\n\nA\n",
    }),
    doc({
      id: "2",
      path: "b.md",
      content: "---\ntags: [验收]\n---\n\nB\n",
    }),
    doc({
      id: "3",
      path: "c.md",
      content: "---\ntags: [Mermaid]\n---\n\nC\n",
    }),
    doc({
      id: "4",
      path: "d.html",
      type: "html",
      content: '<html><head><meta name="keywords" content="验收, HTML" /></head></html>',
    }),
  ];

  it("empty / null filters returns all", () => {
    expect(filteredDocuments(docs, []).map((d) => d.id)).toEqual(["1", "2", "3", "4"]);
    expect(filteredDocuments(docs, null).map((d) => d.id)).toEqual(["1", "2", "3", "4"]);
    expect(filteredDocuments(docs, undefined).map((d) => d.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("single tag matches any doc with that tag", () => {
    expect(filteredDocuments(docs, ["验收"]).map((d) => d.id)).toEqual(["1", "2", "4"]);
  });

  it("multiple tags require ALL (AND)", () => {
    expect(filteredDocuments(docs, ["验收", "HTML"]).map((d) => d.id)).toEqual(["1", "4"]);
    expect(filteredDocuments(docs, ["验收", "Mermaid"]).map((d) => d.id)).toEqual([]);
  });
});

describe("filteredDocuments statusFilter", () => {
  const docs: Document[] = [
    doc({
      id: "d1",
      path: "draft.md",
      content: "---\nstatus: draft\ntags: [待整理]\n---\n\nx\n",
    }),
    doc({
      id: "d2",
      path: "ever.md",
      content: "---\nstatus: evergreen\n---\n\ny\n",
    }),
    doc({
      id: "d3",
      path: "plain.md",
      content: "no frontmatter\n",
    }),
  ];

  it("filters by draft / evergreen / todo", () => {
    expect(filteredDocuments(docs, [], "draft").map((d) => d.id)).toEqual(["d1"]);
    expect(filteredDocuments(docs, [], "evergreen").map((d) => d.id)).toEqual(["d2"]);
    expect(filteredDocuments(docs, [], "todo").map((d) => d.id)).toEqual(["d1"]);
  });
});
