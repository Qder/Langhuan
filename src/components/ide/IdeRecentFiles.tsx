"use client";

import * as React from "react";
import { FileCode2 } from "lucide-react";
import { useIdeStore } from "@/lib/ide/store";
import { IDE_RECENT_FILES_MAX } from "@/lib/ide/recentFiles";
import { cn } from "@/lib/utils";

/**
 * B7 — 最近 8 个文件（跨工程）。Shown on the welcome screen and on the
 * "project open but no file" empty state.
 *
 * Every row goes through `openRecentFile`, which switches project when the row
 * belongs to another one and always reports why a file could not be opened.
 * Rows are therefore never inert — a project that lost its folder grant still
 * produces a readable message instead of a dead click.
 */
export function IdeRecentFiles({
  className,
  currentSessionId,
}: {
  className?: string;
  /** Open project id; rows from it are shown without a project label. */
  currentSessionId?: string | null;
}) {
  const recentFiles = useIdeStore((s) => s.recentFiles);
  const openRecentFile = useIdeStore((s) => s.openRecentFile);

  const rows = React.useMemo(
    () =>
      [...recentFiles]
        .sort((a, b) => b.openedAt - a.openedAt)
        .slice(0, IDE_RECENT_FILES_MAX),
    [recentFiles]
  );

  if (rows.length === 0) return null;

  return (
    <section className={cn("space-y-2", className)}>
      <h2 className="text-xs font-ui uppercase tracking-wide text-[var(--muted)]">
        最近文件
      </h2>
      <ul className="space-y-1">
        {rows.map((f) => {
          const isCurrent =
            !currentSessionId || f.sessionId === currentSessionId;
          const projectLabel = f.projectName || "其他工程";
          return (
            <li key={`${f.sessionId}:${f.path}`}>
              <button
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left",
                  "hover:border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
                )}
                title={
                  isCurrent ? f.path : `${projectLabel} · ${f.path}（点击切换工程）`
                }
                onClick={() => {
                  void openRecentFile({
                    sessionId: f.sessionId,
                    path: f.path,
                    projectName: f.projectName,
                  });
                }}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-[var(--fg)]">
                  {f.path}
                </span>
                {!isCurrent && (
                  <span className="shrink-0 max-w-[40%] truncate text-[10px] font-ui text-[var(--muted)]">
                    {projectLabel}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
