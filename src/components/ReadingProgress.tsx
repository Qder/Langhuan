"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { useReadingProgressPercent } from "@/lib/useReadingProgress";

/**
 * 2px 朱砂 reading progress under the topbar.
 * Markdown: #reader-scroll. HTML: bridge-reported htmlScrollPercent.
 *
 * The percent itself lives in `useReadingProgressPercent` so the 专注 floating
 * strip can show the same number without a second scroll listener.
 */
export function ReadingProgress() {
  const active = useStore((s) => s.getActive());
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const p = useReadingProgressPercent();

  if (!active) return null;
  if (active.type === "html" && htmlImmersive) return null;

  return (
    <div className="absolute top-14 left-0 right-0 h-[2px] z-40 pointer-events-none">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-150"
        style={{ width: `${p}%` }}
      />
    </div>
  );
}
