"use client";

import * as React from "react";
import { useStore } from "@/lib/store";

/**
 * 2px 朱砂 reading progress under the topbar.
 * Markdown: #reader-scroll. HTML: bridge-reported htmlScrollPercent.
 */
export function ReadingProgress() {
  const active = useStore((s) => s.getActive());
  const htmlScrollPercent = useStore((s) => s.htmlScrollPercent);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const [mdP, setMdP] = React.useState(0);

  React.useEffect(() => {
    if (active?.type === "html") return;
    const el = document.getElementById("reader-scroll");
    if (!el) {
      setMdP(0);
      return;
    }
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setMdP(max > 0 ? (el.scrollTop / max) * 100 : 0);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [active?.id, active?.type]);

  if (!active) return null;
  if (active.type === "html" && htmlImmersive) return null;

  const p = active.type === "html" ? htmlScrollPercent : mdP;

  return (
    <div className="absolute top-14 left-0 right-0 h-[2px] z-40 pointer-events-none">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-150"
        style={{ width: `${Math.max(0, Math.min(100, p))}%` }}
      />
    </div>
  );
}
