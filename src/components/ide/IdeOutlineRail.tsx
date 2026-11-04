"use client";

import * as React from "react";
import { PanelRightClose, PanelRight } from "lucide-react";
import { useIdeStore } from "@/lib/ide/store";
import {
  extractFileOutline,
  type OutlineSymbolKind,
} from "@/lib/ide/fileOutline";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<OutlineSymbolKind, string> = {
  class: "类",
  interface: "接口",
  function: "函数",
  method: "方法",
  variable: "变量",
  heading: "标题",
};

const KIND_TONE: Record<OutlineSymbolKind, string> = {
  class: "text-[var(--gold)]",
  interface: "text-[var(--teal)]",
  function: "text-[var(--accent)]",
  method: "text-[var(--accent)]",
  variable: "text-[var(--muted)]",
  heading: "text-[var(--muted)]",
};

export const IDE_OUTLINE_RAIL_WIDTH = 208;

/**
 * B6 — 当前文件大纲. Regex-only, no LSP: the rail is a reading aid, not a tree
 * view. Clicking a row jumps the editor to that line.
 */
export function IdeOutlineRail({
  path,
  draft,
  onCollapse,
  variant = "docked",
}: {
  path: string;
  draft: string;
  onCollapse: () => void;
  /** `overlay` floats over the editor below lg, where a docked rail has no room. */
  variant?: "docked" | "overlay";
}) {
  const openFile = useIdeStore((s) => s.openFile);
  const activeLine = useIdeStore((s) => {
    const reveal = s.pendingReveal;
    return reveal && reveal.path === path ? reveal.line : null;
  });

  const symbols = React.useMemo(
    () => extractFileOutline(path, draft),
    [path, draft]
  );

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-[var(--chrome)]",
        variant === "overlay"
          ? "absolute inset-y-0 right-0 z-40 border-l border-[var(--chrome-border)] shadow-2xl animate-enter"
          : "hidden xl:flex border-l border-[var(--chrome-border)]"
      )}
      style={{ width: IDE_OUTLINE_RAIL_WIDTH }}
      aria-label="当前文件大纲"
    >
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--chrome-border)]">
        <span className="flex-1 min-w-0 text-[11px] font-ui uppercase tracking-wide text-[var(--muted)] truncate">
          大纲
        </span>
        <button
          type="button"
          aria-label="收起大纲"
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          onClick={onCollapse}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1 scroll-thin">
        {symbols.length === 0 ? (
          <p className="px-2.5 py-3 text-[11px] leading-relaxed text-[var(--muted)] font-ui">
            本文件没有可识别的大纲
          </p>
        ) : (
          symbols.map((sym, i) => (
            <button
              key={`${sym.line}:${sym.name}:${i}`}
              type="button"
              className={cn(
                "w-full flex items-baseline gap-1.5 px-2 py-1 text-left text-[11px] font-mono",
                "hover:bg-[var(--hover)] truncate",
                activeLine === sym.line && "bg-[var(--accent)]/10"
              )}
              style={{ paddingLeft: 8 + sym.depth * 8 }}
              title={`${KIND_LABEL[sym.kind]} ${sym.name} · L${sym.line}`}
              onClick={() => void openFile(path, { line: sym.line })}
            >
              <span className={cn("shrink-0 text-[9px]", KIND_TONE[sym.kind])}>
                {KIND_LABEL[sym.kind]}
              </span>
              <span className="truncate text-[var(--fg)]">{sym.name}</span>
              <span className="ml-auto shrink-0 text-[9px] text-[var(--muted)] tabular-nums">
                {sym.line}
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

/** Toolbar toggle for the outline rail (docked on xl, overlay below). */
export function IdeOutlineToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={open ? "隐藏大纲" : "显示大纲"}
      title={open ? "隐藏大纲" : "显示大纲"}
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md p-1.5",
        "max-lg:hidden",
        "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]",
        open && "text-[var(--accent)]"
      )}
    >
      {open ? (
        <PanelRightClose className="h-4 w-4" />
      ) : (
        <PanelRight className="h-4 w-4" />
      )}
    </button>
  );
}
