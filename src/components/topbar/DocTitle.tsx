"use client";

import { relativeTime } from "@/lib/utils";
import { BreadcrumbPath } from "./BreadcrumbPath";
import type { Document } from "@/lib/types";

/**
 * Left side of the header: breadcrumb + HTML freshness + 未保存 pill.
 * Falls back to the library wordmark when no document is active.
 */
export function DocTitle({ active, dirty }: { active: Document | null; dirty: boolean }) {
  if (!active) {
    return (
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <div className="font-serif font-semibold truncate">琅嬛 · 藏书阁</div>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1 flex items-center gap-2">
      <BreadcrumbPath path={active.path} />
      {active.type === "html" && (
        <span className="hidden md:inline shrink-0 text-[11px] text-[var(--muted)] font-ui truncate">
          HTML · 更新于 {relativeTime(active.updatedAt)}
        </span>
      )}
      {dirty && (
        <span className="shrink-0 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] px-2 py-0.5 border border-[var(--accent)]/20">
          未保存
        </span>
      )}
    </div>
  );
}
