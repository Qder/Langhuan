"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { MarkdownReader } from "./MarkdownReader";
import { HtmlReader } from "./HtmlReader";
import { SourceEditor } from "./SourceEditor";

const GUTTER_PX = 6;

/**
 * Keep the preview reader mounted across preview ↔ split so large HTML
 * iframes are not torn down (avoids the white-flash remount).
 * Source-only mode still mounts only the editor.
 */
export function DocWorkspace() {
  const active = useStore((s) => s.getActive());
  const viewMode = useStore((s) => s.viewMode);
  const splitRatio = useStore((s) => s.splitRatio);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const splitSourceFirst = useStore((s) => s.splitSourceFirst);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  const onGutterPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const gutter = e.currentTarget;
      gutter.classList.add("active");
      document.body.style.cursor =
        getComputedStyle(el).flexDirection === "column" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const rect = el.getBoundingClientRect();
        const vertical = getComputedStyle(el).flexDirection === "column";
        const total = vertical ? rect.height : rect.width;
        if (total <= 0) return;
        const pos = vertical ? ev.clientY - rect.top : ev.clientX - rect.left;
        // Convert pointer position → source pane fraction
        let sourceFrac: number;
        if (splitSourceFirst) {
          sourceFrac = pos / total;
        } else {
          sourceFrac = 1 - pos / total;
        }
        setSplitRatio(sourceFrac);
      };

      const onUp = (ev: PointerEvent) => {
        dragging.current = false;
        gutter.classList.remove("active");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          gutter.releasePointerCapture(ev.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [setSplitRatio, splitSourceFirst]
  );

  if (!active) return null;

  if (viewMode === "source") {
    return <SourceEditor doc={active} />;
  }

  const isSplit = viewMode === "split";
  const reader =
    active.type === "html" ? (
      <HtmlReader doc={active} />
    ) : (
      <MarkdownReader doc={active} />
    );

  // Stable tree: source / gutter / preview always present for preview+split.
  // Hidden (not unmounted) when not in split so toggling preview↔split
  // never remounts the iframe / MarkdownReader.
  const sourceFlex = `${splitRatio} 1 0%`;
  const previewFlex = isSplit ? `${1 - splitRatio} 1 0%` : "1 1 auto";

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full min-h-0 flex",
        isSplit ? "flex-col lg:flex-row" : "flex-col"
      )}
    >
      <div
        data-pane="source"
        className={cn("min-h-0 overflow-hidden", !isSplit && "hidden")}
        style={{
          order: splitSourceFirst ? 1 : 3,
          flex: isSplit ? sourceFlex : undefined,
          borderColor: "var(--border)",
        }}
      >
        <div
          className={cn(
            "h-full min-h-0",
            isSplit &&
              (splitSourceFirst
                ? "border-b lg:border-b-0 lg:border-r border-[var(--border)]"
                : "border-t lg:border-t-0 lg:border-l border-[var(--border)]")
          )}
        >
          <SourceEditor doc={active} />
        </div>
      </div>

      <div
        data-pane="gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整分栏大小"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={Math.round(splitRatio * 100)}
        tabIndex={isSplit ? 0 : -1}
        onPointerDown={isSplit ? onGutterPointerDown : undefined}
        onKeyDown={
          isSplit
            ? (e) => {
                const step = e.shiftKey ? 0.08 : 0.04;
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setSplitRatio(splitRatio + (splitSourceFirst ? -step : step));
                } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  setSplitRatio(splitRatio + (splitSourceFirst ? step : -step));
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setSplitRatio(0.2);
                } else if (e.key === "End") {
                  e.preventDefault();
                  setSplitRatio(0.8);
                }
              }
            : undefined
        }
        className={cn(
          "group relative shrink-0 z-10",
          !isSplit && "hidden",
          // stacked on small screens: horizontal bar; lg: vertical bar
          "h-2 w-full cursor-row-resize lg:h-auto lg:w-1.5 lg:cursor-col-resize",
          "bg-[var(--border)]/60 hover:bg-[var(--accent)]/50",
          "focus-visible:outline-none focus-visible:bg-[var(--accent)]/60",
          "transition-colors"
        )}
        style={{ order: 2, flex: `0 0 ${GUTTER_PX}px` }}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-full bg-[var(--accent)] opacity-0 transition-opacity",
            "group-hover:opacity-100 group-[.active]:opacity-100 group-focus-visible:opacity-100",
            // knob
            "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "h-1 w-8 lg:h-8 lg:w-1"
          )}
        />
      </div>

      <div
        data-pane="preview"
        className="min-h-0 overflow-hidden h-full"
        style={{
          order: splitSourceFirst ? 3 : 1,
          flex: previewFlex,
        }}
      >
        {reader}
      </div>
    </div>
  );
}
