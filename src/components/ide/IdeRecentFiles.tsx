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
 * Only files from the *current* project can be opened directly (the browser
 * grants one folder handle at a time), so out-of-project rows are labelled
 * with their project name instead of pretending to be clickable.
 */
export function IdeRecentFiles({
  className,
  currentSessionId,
  onOpenProject,
}: {
  className?: string;
  /** When set, only this project's files are clickable. */
  currentSessionId?: string | null;
  /** Called for a row whose project differs (usually: go pick the folder). */
  onOpenProject?: (sessionId: string) => void;
}) {
  const recentFiles = useIdeStore((s) => s.recentFiles);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);

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
          return (
            <li key={`${f.sessionId}:${f.path}`}>
              <button
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left",
                  "hover:border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
                )}
                title={
                  isCurrent
                    ? f.path
                    : `${f.projectName || "其他工程"} · ${f.path}`
                }
                onClick={() => {
                  if (!isCurrent) {
                    setStatus("先在读码打开该工程");
                    onOpenProject?.(f.sessionId);
                    return;
                  }
                  void openFile(f.path);
                }}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-[var(--fg)]">
                  {f.path}
                </span>
                {!isCurrent && f.projectName && (
                  <span className="shrink-0 max-w-[40%] truncate text-[10px] font-ui text-[var(--muted)]">
                    {f.projectName}
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
