"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  applyGraphFilters,
  buildKnowledgeGraph,
  filterEdgesToNodes,
  initSimNodes,
  neighborhoodGraph,
  shouldUseListLayout,
  tickForce,
  type GraphEdge,
  type GraphNode,
  type SimNode,
} from "@/lib/graph";
import { cn } from "@/lib/utils";

type GraphScope = "all" | "neighborhood";

export function KnowledgeGraphDialog() {
  const open = useStore((s) => s.graphDialogOpen);
  const setOpen = useStore((s) => s.setGraphDialogOpen);
  const documents = useStore((s) => s.documents);
  const activeId = useStore((s) => s.activeId);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const setLinkHealthOpen = useStore((s) => s.setLinkHealthOpen);

  const graph = React.useMemo(() => buildKnowledgeGraph(documents), [documents]);
  const [scope, setScope] = React.useState<GraphScope>("all");
  const [hops, setHops] = React.useState<1 | 2>(1);
  const [filterOrphans, setFilterOrphans] = React.useState(false);
  const [tagFilter, setTagFilter] = React.useState("");
  const [pathPrefix, setPathPrefix] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSelectedId(activeId);
    setQuery("");
    setFilterOrphans(false);
    setTagFilter("");
    setPathPrefix("");
    setScope("all");
    setHops(1);
  }, [open, activeId]);

  const scoped = React.useMemo(() => {
    if (scope !== "neighborhood") return graph;
    if (!activeId) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    return neighborhoodGraph(graph, activeId, hops);
  }, [graph, scope, activeId, hops]);

  const filteredNodes = React.useMemo(() => {
    let nodes = applyGraphFilters(scoped.nodes, {
      orphansOnly: filterOrphans,
      pathPrefix,
      tag: tagFilter,
    });
    const q = query.trim().toLowerCase();
    if (q) {
      nodes = nodes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
      );
    }
    return nodes;
  }, [scoped.nodes, filterOrphans, pathPrefix, tagFilter, query]);

  const filteredIds = React.useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = React.useMemo(
    () => filterEdgesToNodes(scoped.edges, filteredIds),
    [scoped.edges, filteredIds]
  );

  const useList = shouldUseListLayout(filteredNodes.length) || Boolean(query.trim());

  const currentId = selectedId || activeId;

  const outLinks = React.useMemo(() => {
    if (!currentId) return [] as GraphEdge[];
    return graph.edges.filter((e) => e.from === currentId);
  }, [graph.edges, currentId]);

  const inLinks = React.useMemo(() => {
    if (!currentId) return [] as GraphEdge[];
    return graph.edges.filter((e) => e.to === currentId);
  }, [graph.edges, currentId]);

  const nodeById = React.useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes]
  );

  const openNode = (id: string) => {
    openDoc(id);
    setOpen(false);
  };

  const needsCenter = scope === "neighborhood" && !activeId;

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      className="max-w-3xl overflow-hidden p-0"
      labelledBy="graph-title"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 gap-3">
        <div className="min-w-0">
          <h2 id="graph-title" className="font-serif text-lg font-semibold">
            知识图谱
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {filteredNodes.length} 节点 · {filteredEdges.length} 边
            {scope === "neighborhood" ? ` · 邻域 ${hops} 跳` : ""}
            {" · 孤立 "}
            {graph.nodes.filter((n) => n.orphan).length}
            {useList && filteredNodes.length > 0 ? " · 列表导航" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinkHealthOpen(true)}
          >
            打开体检
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-1",
              scope === "all" && "bg-[var(--hover)] font-medium"
            )}
            onClick={() => setScope("all")}
          >
            全库
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-1",
              scope === "neighborhood" && "bg-[var(--hover)] font-medium"
            )}
            onClick={() => setScope("neighborhood")}
          >
            邻域
          </button>
        </div>
        {scope === "neighborhood" && (
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
            <button
              type="button"
              className={cn("rounded-md px-2 py-1", hops === 1 && "bg-[var(--hover)] font-medium")}
              onClick={() => setHops(1)}
            >
              1 跳
            </button>
            <button
              type="button"
              className={cn("rounded-md px-2 py-1", hops === 2 && "bg-[var(--hover)] font-medium")}
              onClick={() => setHops(2)}
            >
              2 跳
            </button>
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题或路径…"
          className="h-8 min-w-[10rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-sm"
        />
        <input
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="标签过滤…"
          className="h-8 w-28 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-sm"
        />
        <input
          value={pathPrefix}
          onChange={(e) => setPathPrefix(e.target.value)}
          placeholder="路径前缀…"
          className="h-8 w-28 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-sm"
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={filterOrphans}
            onChange={(e) => setFilterOrphans(e.target.checked)}
          />
          仅孤立节点
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] min-h-[min(60vh,480px)]">
        <div className="min-h-0 border-b md:border-b-0 md:border-r border-[var(--border)]">
          {needsCenter ? (
            <EmptyCanvas message="邻域视图需要先打开一篇文档作为中心。" />
          ) : filteredNodes.length === 0 ? (
            <EmptyCanvas message="没有匹配的节点。试试放宽标签、路径或孤立过滤。" />
          ) : useList ? (
            <GraphNodeList
              nodes={filteredNodes}
              currentId={currentId}
              onSelect={setSelectedId}
              onOpen={openNode}
            />
          ) : (
            <GraphForceView
              nodes={filteredNodes}
              edges={filteredEdges}
              currentId={currentId}
              onSelect={setSelectedId}
              onOpen={openNode}
            />
          )}
        </div>
        <aside className="p-3 text-sm space-y-3 overflow-auto">
          {currentId && nodeById.get(currentId) ? (
            <>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  当前
                </div>
                <button
                  type="button"
                  className="mt-1 w-full text-left font-medium hover:text-[var(--accent)]"
                  onClick={() => openNode(currentId)}
                >
                  {nodeById.get(currentId)!.title}
                </button>
                <div className="text-[11px] text-[var(--muted)] truncate">
                  {nodeById.get(currentId)!.path}
                </div>
                {nodeById.get(currentId)!.orphan && (
                  <div className="mt-1 text-[11px] text-[var(--gold)]">孤立文档</div>
                )}
              </div>
              <LinkGroup
                title={`链出（${outLinks.length}）`}
                edges={outLinks}
                resolve={(e) => nodeById.get(e.to)}
                onOpen={openNode}
                onSelect={setSelectedId}
              />
              <LinkGroup
                title={`链入（${inLinks.length}）`}
                edges={inLinks}
                resolve={(e) => nodeById.get(e.from)}
                onOpen={openNode}
                onSelect={setSelectedId}
              />
            </>
          ) : (
            <p className="text-xs text-[var(--muted)]">选择一个节点查看链出 / 链入。</p>
          )}
        </aside>
      </div>
    </Dialog>
  );
}

function EmptyCanvas({ message }: { message: string }) {
  return (
    <div className="flex h-[min(56vh,440px)] items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
      {message}
    </div>
  );
}

function GraphNodeList({
  nodes,
  currentId,
  onSelect,
  onOpen,
}: {
  nodes: GraphNode[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="max-h-[min(60vh,480px)] overflow-auto p-2 space-y-0.5">
      {nodes.length === 0 && (
        <li className="px-2 py-6 text-center text-xs text-[var(--muted)]">无匹配节点</li>
      )}
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--hover)]",
              currentId === n.id && "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
            )}
            onClick={() => onSelect(n.id)}
            onDoubleClick={() => onOpen(n.id)}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                n.orphan ? "border border-[var(--muted)]" : "bg-[var(--accent)]"
              )}
            />
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
            {n.orphan && (
              <span className="text-[10px] text-[var(--muted)] shrink-0">孤立</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinkGroup({
  title,
  edges,
  resolve,
  onOpen,
  onSelect,
}: {
  title: string;
  edges: GraphEdge[];
  resolve: (e: GraphEdge) => GraphNode | undefined;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{title}</div>
      {edges.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--muted)]">无</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {edges.map((e) => {
            const n = resolve(e);
            if (!n) return null;
            return (
              <li key={`${e.from}-${e.to}`}>
                <button
                  type="button"
                  className="w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-[var(--hover)]"
                  onClick={() => onSelect(n.id)}
                  onDoubleClick={() => onOpen(n.id)}
                >
                  {n.title}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GraphForceView({
  nodes,
  edges,
  currentId,
  onSelect,
  onOpen,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [sim, setSim] = React.useState<SimNode[]>([]);
  const edgesRef = React.useRef(edges);
  const dragRef = React.useRef<{ id: string; dx: number; dy: number } | null>(null);
  const size = { w: 720, h: 480 };

  React.useEffect(() => {
    edgesRef.current = edges;
    setSim(initSimNodes(nodes, size.w, size.h));
  }, [nodes, edges]);

  React.useEffect(() => {
    if (sim.length === 0) return;
    let frame = 0;
    let alpha = 0.85;
    let alive = true;
    const step = () => {
      if (!alive) return;
      setSim((prev) => {
        const next = prev.map((n) => ({ ...n }));
        tickForce(next, edgesRef.current, size.w, size.h, alpha);
        return next;
      });
      alpha *= 0.985;
      frame += 1;
      if (frame < 180 && alpha > 0.02) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [sim.length]);

  const byId = React.useMemo(() => new Map(sim.map((n) => [n.id, n])), [sim]);

  return (
    <div className="bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] p-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="w-full h-[min(56vh,440px)] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]"
        onMouseMove={(e) => {
          const drag = dragRef.current;
          if (!drag || !svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * size.w - drag.dx;
          const y = ((e.clientY - rect.top) / rect.height) * size.h - drag.dy;
          setSim((prev) =>
            prev.map((n) => (n.id === drag.id ? { ...n, x, y, vx: 0, vy: 0 } : n))
          );
        }}
        onMouseUp={() => {
          dragRef.current = null;
        }}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
      >
        {edgesRef.current.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--border)"
              strokeWidth={1.2}
            />
          );
        })}
        {sim.map((n) => {
          const r = 6 + Math.min(14, n.inbound * 3);
          const active = n.id === currentId;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: "pointer" }}
              onMouseDown={(e) => {
                e.preventDefault();
                dragRef.current = { id: n.id, dx: 0, dy: 0 };
              }}
              onClick={() => onSelect(n.id)}
              onDoubleClick={() => onOpen(n.id)}
            >
              <circle
                r={r + (active ? 3 : 0)}
                fill={n.orphan ? "transparent" : "var(--accent)"}
                stroke={active ? "var(--gold)" : n.orphan ? "var(--muted)" : "var(--accent)"}
                strokeWidth={active ? 2.5 : n.orphan ? 1.5 : 0}
                opacity={n.type === "html" ? 0.55 : 0.9}
              />
              <text
                y={r + 12}
                textAnchor="middle"
                className="fill-[var(--fg)]"
                style={{ fontSize: 10, fontFamily: "var(--font-sans)" }}
              >
                {n.title.length > 10 ? n.title.slice(0, 10) + "…" : n.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
