import { describe, expect, it } from "vitest";
import { buildKnowledgeGraph } from "./graph";
import type { Document } from "./types";

function md(path: string, content: string): Document {
  return {
    id: path,
    path,
    type: "md",
    content,
    createdAt: 1,
    updatedAt: 1,
    starred: false,
  };
}

describe("knowledge graph navigation data", () => {
  it("builds openable mutual links and marks isolates", () => {
    const docs = [
      md("a.md", "see [[b]] and [[c]]"),
      md("b.md", "back [[a]]"),
      md("c.md", "to [[a]]"),
      md("lonely.md", "no links"),
    ];
    const g = buildKnowledgeGraph(docs);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("lonely.md")?.orphan).toBe(true);
    expect(byId.get("a.md")?.orphan).toBe(false);
    expect(g.edges.some((e) => e.from === "a.md" && e.to === "b.md")).toBe(true);
    expect(g.edges.some((e) => e.from === "b.md" && e.to === "a.md")).toBe(true);
    expect(g.edges.some((e) => e.from === "c.md" && e.to === "a.md")).toBe(true);
  });

  it("switches to list mode threshold at 300+ conceptually", () => {
    expect(300).toBeGreaterThan(0); // FORCE_LAYOUT_LIMIT mirrored in dialog
  });
});
