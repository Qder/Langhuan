"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  buildKnowledgeGraph,
  initSimNodes,
  tickForce,
  type SimNode,
} from "@/lib/graph";

export function KnowledgeGraphDialog() {
  const open = useStore((s) => s.graphDialogOpen);
  const setOpen = useStore((s) => s.setGraphDialogOpen);
  const documents = useStore((s) => s.documents);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = React.useState<SimNode[]>([]);
  const edgesRef = React.useRef<{ from: string; to: string }[]>([]);
  const dragRef = React.useRef<{ id: string; dx: number; dy: number } | null>(null);
  const size = { w: 720, h: 480 };

  React.useEffect(() => {
    if (!open) return;
    const g = buildKnowledgeGraph(documents);
    edgesRef.current = g.edges;
    setNodes(initSimNodes(g.nodes, size.w, size.h));
  }, [open, documents]);

  React.useEffect(() => {
    if (!open || nodes.length === 0) return;
    let frame = 0;
    let alpha = 0.85;
    let alive = true;
    const step = () => {
      if (!alive) return;
      setNodes((prev) => {
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
  }, [open, nodes.length]);

  const byId = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const orphans = nodes.filter((n) => n.orphan).length;

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      className="max-w-3xl overflow-hidden p-0"
      labelledBy="graph-title"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 id="graph-title" className="font-serif text-lg font-semibold">
            知识图谱
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {nodes.length} 节点 · {edgesRef.current.length} 边 · 孤立 {orphans}
            （节点越大被引用越多；点空心环为孤立笔记）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          关闭
        </Button>
      </div>
      <div className="bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="w-full h-[min(60vh,480px)] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]"
          onMouseMove={(e) => {
            const drag = dragRef.current;
            if (!drag || !svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * size.w - drag.dx;
            const y = ((e.clientY - rect.top) / rect.height) * size.h - drag.dy;
            setNodes((prev) =>
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
          {nodes.map((n) => {
            const r = 6 + Math.min(14, n.inbound * 3);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: "pointer" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragRef.current = { id: n.id, dx: 0, dy: 0 };
                }}
                onClick={() => {
                  openDoc(n.id);
                  setOpen(false);
                }}
              >
                <circle
                  r={r}
                  fill={n.orphan ? "transparent" : "var(--accent)"}
                  stroke={n.orphan ? "var(--muted)" : "var(--accent)"}
                  strokeWidth={n.orphan ? 1.5 : 0}
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
    </Dialog>
  );
}
