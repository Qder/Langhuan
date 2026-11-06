"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  codeExcludedNote,
  formatCount,
  readingBreakdown,
  readingStatsOf,
  readingTimeLabel,
  type ReadingStats,
} from "@/lib/readingStats";

/**
 * 篇级统计卡片。阅读弹层与专注浮动条共用同一份 DOM/口径，
 * 所以两处永远不会出现「字数对不上」这种尴尬。
 */
export function ReadingStatsCard({
  stats,
  className,
  compact,
}: {
  stats: ReadingStats;
  className?: string;
  /** 紧凑一行：给浮动条这种宽度紧张的地方。 */
  compact?: boolean;
}) {
  const note = codeExcludedNote(stats);
  if (compact) {
    return (
      <span className={cn("text-[11px] font-ui tabular-nums text-[var(--muted)]", className)}>
        {formatCount(stats.chars)} 字 · {readingTimeLabel(stats)}
      </span>
    );
  }
  return (
    <div
      className={cn("rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5", className)}
      data-reading-stats=""
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)] font-ui">
        本篇
      </div>
      <div className="flex items-baseline gap-1.5 font-ui">
        <span className="text-lg leading-none tabular-nums">{formatCount(stats.chars)}</span>
        <span className="text-xs text-[var(--muted)]">字</span>
        <span className="mx-0.5 text-[var(--border)]" aria-hidden>
          ·
        </span>
        <span className="text-xs tabular-nums">{readingTimeLabel(stats)}</span>
      </div>
      <div className="mt-1 text-[11px] text-[var(--muted)] font-ui">
        {readingBreakdown(stats)}
        {note && <span className="block opacity-80">{note}</span>}
      </div>
    </div>
  );
}

/**
 * 从文档内容算统计。`type` 决定走 Markdown 还是 HTML 口径；
 * 计算是纯同步的，内容变了自然重算，不需要额外缓存。
 */
export function useReadingStats(content: string, type: "md" | "html" = "md"): ReadingStats {
  return React.useMemo(() => readingStatsOf(content, type), [content, type]);
}
