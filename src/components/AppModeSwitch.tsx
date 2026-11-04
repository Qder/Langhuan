"use client";

import { useStore } from "@/lib/store";
import { useIdeStore } from "@/lib/ide/store";
import { cn } from "@/lib/utils";

/** 藏书阁 | 读码 — shared mode switch for both shells. */
export function AppModeSwitch({ className }: { className?: string }) {
  const appMode = useStore((s) => s.appMode);
  const setAppMode = useStore((s) => s.setAppMode);
  const requestSwitchToNotes = useIdeStore((s) => s.requestSwitchToNotes);

  const goNotes = () => {
    if (appMode === "notes") return;
    if (requestSwitchToNotes()) setAppMode("notes");
  };

  const goIde = () => {
    if (appMode === "ide") return;
    setAppMode("ide");
  };

  return (
    <div
      role="tablist"
      aria-label="应用模式"
      className={cn(
        "inline-flex shrink-0 rounded-xl border border-[var(--chrome-border)] bg-[var(--card)] p-0.5 font-ui",
        className
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={appMode === "notes"}
        onClick={goNotes}
        className={cn(
          "px-2 py-1 max-lg:min-h-9 max-lg:px-2.5 text-[11px] rounded-[10px] transition-colors",
          appMode === "notes"
            ? "bg-[var(--accent)] text-white"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        )}
      >
        藏书阁
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={appMode === "ide"}
        onClick={goIde}
        className={cn(
          "px-2 py-1 max-lg:min-h-9 max-lg:px-2.5 text-[11px] rounded-[10px] transition-colors",
          appMode === "ide"
            ? "bg-[var(--accent)] text-white"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        )}
      >
        读码
      </button>
    </div>
  );
}
