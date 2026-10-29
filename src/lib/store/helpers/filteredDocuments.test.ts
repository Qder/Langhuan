import { describe, expect, it } from "vitest";
import type { Document } from "../../types";
import { filteredDocuments } from "./filteredDocuments";

function doc(partial: Partial<Document> & Pick<Document, "id" | "path" | "content">): Document {
  return {
    type: "md",
    starred: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("store/helpers filteredDocuments", () => {
  it("AND-matches tags", () => {
    const docs = [
      doc({ id: "1", path: "a.md", content: "---\ntags: [A, B]\n---\n\nx\n" }),
      doc({ id: "2", path: "b.md", content: "---\ntags: [A]\n---\n\ny\n" }),
    ];
    expect(filteredDocuments(docs, ["A", "B"]).map((d) => d.id)).toEqual(["1"]);
  });
});
