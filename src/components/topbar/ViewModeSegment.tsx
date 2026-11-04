"use client";

import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";

/**
 * The three visible view modes. `mixed` is intentionally absent — it is
 * demoted to the command palette / 更多 menu because preview supports
 * click-to-edit now.
 */
export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "preview", label: "预览" },
  { id: "split", label: "分栏" },
  { id: "source", label: "源码" },
];

/** `split` needs room for two panes, so phones only offer 预览 | 源码. */
export function viewModesFor(tabletUp: boolean) {
  return VIEW_MODES.filter((m) => tabletUp || m.id !== "split");
}

/**
 * The sm+ segmented control in the header. Hidden below sm, where the same
 * three modes live inside 阅读 (and in 更多 for the mid tier).
 */
export function ViewModeSegment({
  viewMode,
  onChange,
  tabletUp,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  tabletUp: boolean;
}) {
  return (
    <div
      className="hidden sm:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
      role="tablist"
      aria-label="视图切换"
    >
      {viewModesFor(tabletUp).map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={viewMode === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            "px-2.5 py-1 max-lg:min-h-10 max-lg:px-3 text-xs rounded-[10px] transition-colors font-ui inline-flex items-center justify-center",
            viewMode === m.id
              ? "bg-[var(--accent)] text-white"
              : "hover:bg-[var(--hover)]"
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
