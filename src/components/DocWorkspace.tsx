"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { MarkdownReader } from "./MarkdownReader";
import { HtmlReader } from "./HtmlReader";
import { SourceEditor } from "./SourceEditor";
import { MixedMdView } from "./editor/MixedMdView";
import { ResizeGutter } from "./ui/ResizeGutter";

/**
 * Keep the preview reader mounted across preview ↔ split so large HTML
 * iframes are not torn down (avoids the white-flash remount).
 * Source-only mode still mounts only the editor.
 *
 * Optional `docId` enables dual-document split (otherwise uses activeId).
 */
export function DocWorkspace({ docId }: { docId?: string }) {
  const resolvedId = useStore((s) => docId ?? s.activeId);
  const active = useStore((s) =>
    s.documents.find((d) => d.id === resolvedId) || null
  );
  const viewMode = useStore((s) => s.viewMode);
  const splitRatio = useStore((s) => s.splitRatio);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const splitSourceFirst = useStore((s) => s.splitSourceFirst);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const secondaryId = useStore((s) => s.secondaryId);
  const activeId = useStore((s) => s.activeId);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const resolveAxis = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return "horizontal" as const;
    return getComputedStyle(el).flexDirection === "column"
      ? ("vertical" as const)
      : ("horizontal" as const);
  }, []);

  /** Read live store on every delta — React closures lag behind pointermove. */
  const onSplitDelta = React.useCallback((deltaPx: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vertical = getComputedStyle(el).flexDirection === "column";
    const total = vertical ? rect.height : rect.width;
    if (total <= 0) return;
    const deltaFrac = deltaPx / total;
    const { splitRatio: ratio, splitSourceFirst: sourceFirst } = useStore.getState();
    if (sourceFirst) {
      setSplitRatio(ratio + deltaFrac);
    } else {
      setSplitRatio(ratio - deltaFrac);
    }
  }, [setSplitRatio]);

  const resetSplit = React.useCallback(() => {
    setSplitRatio(0.5);
  }, [setSplitRatio]);

  const onFocusPane = () => {
    if (!resolvedId || !secondaryId) return;
    if (resolvedId === activeId) {
      setFocusedPane("primary");
      return;
    }
    if (resolvedId === secondaryId && activeId) {
      // Swap panes: clicked doc becomes primary/active, former active becomes secondary
      setFocusedPane("secondary");
      useStore.setState({
        activeId: resolvedId,
        secondaryId: activeId,
        focusedPane: "primary",
      });
    }
  };

  if (!active) return null;

  if (viewMode === "source") {
    return (
      <div className="h-full" onMouseDown={onFocusPane}>
        <SourceEditor doc={active} />
      </div>
    );
  }

  if (viewMode === "mixed" && active.type === "md") {
    return (
      <div className="h-full" onMouseDown={onFocusPane}>
        <MixedMdView doc={active} />
      </div>
    );
  }

  const isSplit = viewMode === "split";
  const reader =
    active.type === "html" ? (
      <HtmlReader doc={active} />
    ) : (
      <MarkdownReader doc={active} />
    );

  // flex-basis percentages keep panes proportional; gutter stays shrink-0
  const sourceFlex = `${splitRatio} 1 0%`;
  const previewFlex = isSplit ? `${1 - splitRatio} 1 0%` : "1 1 auto";

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full min-h-0 flex",
        isSplit ? "flex-col lg:flex-row" : "flex-col"
      )}
      onMouseDown={onFocusPane}
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

      <ResizeGutter
        className={cn(
          !isSplit && "hidden",
          "h-1.5 w-full cursor-row-resize self-auto",
          "lg:h-auto lg:w-2 lg:cursor-col-resize lg:self-stretch"
        )}
        style={{ order: 2 }}
        axis="horizontal"
        resolveAxis={resolveAxis}
        label="调整分栏大小"
        value={Math.round(splitRatio * 100)}
        min={20}
        max={80}
        onDelta={(d) => onSplitDelta(d)}
        onReset={resetSplit}
        disabled={!isSplit}
      />

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

/** Side-by-side two documents when secondaryId is set. */
export function DualDocLayout() {
  const activeId = useStore((s) => s.activeId);
  const secondaryId = useStore((s) => s.secondaryId);
  const docSplitRatio = useStore((s) => s.docSplitRatio);
  const setDocSplitRatio = useStore((s) => s.setDocSplitRatio);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const onDelta = React.useCallback(
    (deltaPx: number) => {
      const el = containerRef.current;
      if (!el) return;
      const total = el.getBoundingClientRect().width;
      if (total <= 0) return;
      setDocSplitRatio(useStore.getState().docSplitRatio + deltaPx / total);
    },
    [setDocSplitRatio]
  );

  if (!activeId) return null;
  if (!secondaryId || secondaryId === activeId) {
    return <DocWorkspace docId={activeId} />;
  }

  return (
    <div ref={containerRef} className="h-full min-h-0 flex flex-row">
      <div
        className="min-h-0 overflow-hidden border-r border-[var(--border)]"
        style={{ flex: `${docSplitRatio} 1 0%` }}
      >
        <DocWorkspace docId={activeId} />
      </div>
      <ResizeGutter
        className="w-2 cursor-col-resize self-stretch"
        axis="horizontal"
        label="调整文档分屏"
        value={Math.round(docSplitRatio * 100)}
        min={20}
        max={80}
        onDelta={onDelta}
        onReset={() => setDocSplitRatio(0.5)}
      />
      <div className="min-h-0 overflow-hidden" style={{ flex: `${1 - docSplitRatio} 1 0%` }}>
        <DocWorkspace docId={secondaryId} />
      </div>
    </div>
  );
}
