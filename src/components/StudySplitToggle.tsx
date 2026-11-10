"use client";

import { Columns2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Touch-sized toggle for the note+code workbench. Not hover-only. */
export function StudySplitToggle({ className }: { className?: string }) {
  const enabled = useStore((s) => s.studySplitEnabled);
  const setEnabled = useStore((s) => s.setStudySplitEnabled);

  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label="笔记与源码并排"
      title="横屏时笔记与源码并排；竖屏可在两者间切换，布局会保留"
      onClick={() => setEnabled(!enabled)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--chrome-border)] bg-[var(--card)] px-2 py-1 max-lg:min-h-10 max-lg:px-2.5 text-[11px] font-ui transition-colors",
        enabled
          ? "bg-[var(--accent)] text-white border-transparent"
          : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]",
        className
      )}
    >
      <Columns2 className="h-3.5 w-3.5" aria-hidden />
      并排
    </button>
  );
}
