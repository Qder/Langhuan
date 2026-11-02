import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraph,
  FORCE_LAYOUT_LIMIT,
  shouldUseListLayout,
} from "./graph";
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
    expect(shouldUseListLayout(g.nodes.length)).toBe(false);
  });

  it("uses list mode when node count exceeds FORCE_LAYOUT_LIMIT", () => {
    const docs = Array.from({ length: FORCE_LAYOUT_LIMIT + 1 }, (_, i) =>
      md(`n${i}.md`, `note ${i}`),
    );
    const g = buildKnowledgeGraph(docs);
    expect(g.nodes.length).toBe(FORCE_LAYOUT_LIMIT + 1);
    expect(g.nodes.length).toBeGreaterThan(FORCE_LAYOUT_LIMIT);
    expect(shouldUseListLayout(g.nodes.length)).toBe(true);
    expect(shouldUseListLayout(FORCE_LAYOUT_LIMIT)).toBe(false);
  });
});
