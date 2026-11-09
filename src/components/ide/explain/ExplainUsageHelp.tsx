"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import {
  IDE_EXPLAIN_USAGE_INTRO,
  IDE_NOTE_DESTINATION_HINT,
} from "@/lib/ide/captureNote";
import { cn } from "@/lib/utils";

/**
 * Compact 「？ 使用说明」 toggle for the explain empty state.
 * Replaces the always-on help paragraph so narrow Android keeps room for chips.
 * Toggle / Esc / outside click closes; touch targets stay ≥ 40px.
 */
export function ExplainUsageHelp({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    // Pointer capture so Android tap-outside works without waiting for click.
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative text-left", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 min-h-10 px-2.5 py-1.5 rounded-lg",
          "border border-[var(--border)] text-xs font-ui text-[var(--muted)]",
          "hover:bg-[var(--hover)] hover:text-[var(--fg)]",
          open && "bg-[var(--hover)] text-[var(--fg)]"
        )}
        aria-label="使用说明"
        aria-expanded={open}
        aria-controls="lh-explain-usage-help"
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        使用说明
      </button>
      {open ? (
        <div
          id="lh-explain-usage-help"
          role="region"
          aria-label="讲解使用说明"
          className={cn(
            "mt-2 max-h-[min(50vh,20rem)] overflow-y-auto overscroll-contain",
            "rounded-xl border border-[var(--border)] bg-[var(--card)]",
            "px-3 py-2.5 space-y-1.5 text-xs leading-relaxed text-[var(--muted)]",
            "shadow-md"
          )}
        >
          <p>{IDE_EXPLAIN_USAGE_INTRO}</p>
          {IDE_NOTE_DESTINATION_HINT.split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
