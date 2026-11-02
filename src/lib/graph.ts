import type { Document } from "./types";
import { getDocMeta } from "./docMeta";
import { resolveWikiTarget } from "./search";
import { titleOf } from "./utils";
import { extractWikiLinks } from "./wikilink";

export type GraphNode = {
  id: string;
  title: string;
  path: string;
  type: Document["type"];
  inbound: number;
  orphan: boolean;
  tags: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Above this node count the graph dialog uses list+search instead of force layout. */
export const FORCE_LAYOUT_LIMIT = 300;

export function shouldUseListLayout(nodeCount: number): boolean {
  return nodeCount > FORCE_LAYOUT_LIMIT;
}

/** Undirected hops from center along wikilink edges (1 or 2). */
export function collectNeighborhoodIds(
  edges: GraphEdge[],
  centerId: string,
  hops: number
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  const seen = new Set<string>([centerId]);
  let frontier = [centerId];
  const maxHops = Math.max(0, Math.floor(hops));
  for (let h = 0; h < maxHops; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) || []) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

export function subgraphForIds(graph: KnowledgeGraph, ids: Set<string>): KnowledgeGraph {
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}

/** Centered neighborhood view: center + in/out neighbors within N hops. */
export function neighborhoodGraph(
  graph: KnowledgeGraph,
  centerId: string,
  hops: 1 | 2
): KnowledgeGraph {
  if (!graph.nodes.some((n) => n.id === centerId)) {
    return { nodes: [], edges: [] };
  }
  return subgraphForIds(graph, collectNeighborhoodIds(graph.edges, centerId, hops));
}

export type GraphViewFilter = {
  orphansOnly?: boolean;
  /** Path prefix, case-insensitive (e.g. "notes/"). */
  pathPrefix?: string;
  /** Exact tag match, case-insensitive. */
  tag?: string;
};

export function applyGraphFilters(
  nodes: GraphNode[],
  filter: GraphViewFilter
): GraphNode[] {
  const prefix = (filter.pathPrefix || "").trim().toLowerCase();
  const tag = (filter.tag || "").trim().toLowerCase();
  return nodes.filter((n) => {
    if (filter.orphansOnly && !n.orphan) return false;
    if (prefix && !n.path.toLowerCase().startsWith(prefix)) return false;
    if (tag && !n.tags.some((t) => t.toLowerCase() === tag)) return false;
    return true;
  });
}

export function filterEdgesToNodes(edges: GraphEdge[], nodeIds: Set<string>): GraphEdge[] {
  return edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
}

export function buildKnowledgeGraph(docs: Document[]): KnowledgeGraph {
  const inbound = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const edgeKey = new Set<string>();

  for (const d of docs) {
    if (d.type !== "md") continue;
    for (const r of extractWikiLinks(d.content)) {
      if (!r.target) continue;
      const target = resolveWikiTarget(docs, r.target);
      if (!target || target.id === d.id) continue;
      const key = `${d.id}->${target.id}`;
      if (edgeKey.has(key)) continue;
      edgeKey.add(key);
      edges.push({ from: d.id, to: target.id });
      inbound.set(target.id, (inbound.get(target.id) || 0) + 1);
    }
  }

  const linked = new Set<string>();
  for (const e of edges) {
    linked.add(e.from);
    linked.add(e.to);
  }

  const nodes: GraphNode[] = docs.map((d) => {
    const inCount = inbound.get(d.id) || 0;
    const meta = getDocMeta(d);
    return {
      id: d.id,
      title: meta.title || titleOf(d.path),
      path: d.path,
      type: d.type,
      inbound: inCount,
      orphan: d.type === "md" && !linked.has(d.id),
      tags: meta.tags,
    };
  });

  return { nodes, edges };
}

export type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export function initSimNodes(nodes: GraphNode[], width: number, height: number): SimNode[] {
  const cx = width / 2;
  const cy = height / 2;
  return nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = 40 + (i % 7) * 18;
    return {
      ...n,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    };
  });
}

export function tickForce(
  nodes: SimNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  alpha = 0.4
): void {
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let dist2 = dx * dx + dy * dy;
      if (dist2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        dist2 = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(dist2);
      const force = (900 * alpha) / dist2;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  for (const e of edges) {
    const i = idIndex.get(e.from);
    const j = idIndex.get(e.to);
    if (i == null || j == null) continue;
    const a = nodes[i];
    const b = nodes[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ideal = 90;
    const f = ((dist - ideal) * 0.04 * alpha) / dist;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * 0.01 * alpha;
    n.vy += (cy - n.y) * 0.01 * alpha;
    n.vx *= 0.85;
    n.vy *= 0.85;
    n.x = Math.min(width - 12, Math.max(12, n.x + n.vx));
    n.y = Math.min(height - 12, Math.max(12, n.y + n.vy));
  }
}
