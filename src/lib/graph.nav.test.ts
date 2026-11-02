import { describe, expect, it } from "vitest";
import {
  applyGraphFilters,
  buildKnowledgeGraph,
  FORCE_LAYOUT_LIMIT,
  neighborhoodGraph,
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

  it("neighborhood 1 hop around a excludes lonely", () => {
    const docs = [
      md("a.md", "see [[b]]"),
      md("b.md", "back [[a]]"),
      md("c.md", "to [[a]]"),
      md("lonely.md", "no links"),
    ];
    const g = buildKnowledgeGraph(docs);
    const n1 = neighborhoodGraph(g, "a.md", 1);
    const ids = new Set(n1.nodes.map((n) => n.id));
    expect(ids.has("a.md")).toBe(true);
    expect(ids.has("b.md")).toBe(true);
    expect(ids.has("c.md")).toBe(true);
    expect(ids.has("lonely.md")).toBe(false);
    expect(shouldUseListLayout(n1.nodes.length)).toBe(false);
  });

  it("filters by tag and path prefix; empty when nothing matches", () => {
    const docs = [
      md("notes/a.md", "---\ntags: [alpha]\n---\n\nsee [[b]]"),
      md("notes/b.md", "---\ntags: [beta]\n---\n\nback [[a]]"),
      md("other/lonely.md", "---\ntags: [alpha]\n---\n\nno links"),
    ];
    // Fix ids to match paths for resolveWikiTarget - use path as id already
    // But wiki resolve needs titles. Adjust content:
    docs[0] = md(
      "notes/a.md",
      "---\ntitle: a\ntags: [alpha]\n---\n\nsee [[b]]",
    );
    docs[1] = md(
      "notes/b.md",
      "---\ntitle: b\ntags: [beta]\n---\n\nback [[a]]",
    );
    docs[2] = md(
      "other/lonely.md",
      "---\ntitle: lonely\ntags: [alpha]\n---\n\nno links",
    );
    const g = buildKnowledgeGraph(docs);
    const byTag = applyGraphFilters(g.nodes, { tag: "alpha" });
    expect(byTag.map((n) => n.id).sort()).toEqual(
      ["notes/a.md", "other/lonely.md"].sort(),
    );
    const byPrefix = applyGraphFilters(g.nodes, { pathPrefix: "notes/" });
    expect(byPrefix.map((n) => n.id).sort()).toEqual(
      ["notes/a.md", "notes/b.md"].sort(),
    );
    const empty = applyGraphFilters(g.nodes, {
      tag: "alpha",
      pathPrefix: "notes/",
      orphansOnly: true,
    });
    // notes/a is linked, not orphan → empty
    expect(empty).toEqual([]);
    const emptyTag = applyGraphFilters(g.nodes, { tag: "nope" });
    expect(emptyTag).toEqual([]);
  });
});
