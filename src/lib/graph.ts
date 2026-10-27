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
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

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
    return {
      id: d.id,
      title: getDocMeta(d).title || titleOf(d.path),
      path: d.path,
      type: d.type,
      inbound: inCount,
      orphan: d.type === "md" && !linked.has(d.id),
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
