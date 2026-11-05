"use client";

import * as React from "react";
import { useStore } from "@/lib/store";

/** `#reader-scroll` — the one scroller the MD reader actually scrolls. */
export const READER_SCROLL_ID = "reader-scroll";

/** 0–100. `max <= 0` (not scrollable yet) reads as 0, matching the pre-split bar. */
export function scrollPercentOf(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight"> | null
): number {
  if (!el) return 0;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return 0;
  return (el.scrollTop / max) * 100;
}

/**
 * Reading progress percent for the active document.
 *
 * Single source of truth so the topbar bar and the 专注 floating strip cannot
 * drift apart: markdown reads `#reader-scroll`, HTML reads the bridge value.
 * The bar used to own this effect; it now calls this hook unchanged in
 * behaviour (same listener, same deps, same clamping).
 */
export function useReadingProgressPercent(): number {
  const active = useStore((s) => s.getActive());
  const htmlScrollPercent = useStore((s) => s.htmlScrollPercent);
  const [mdP, setMdP] = React.useState(0);

  React.useEffect(() => {
    if (active?.type === "html") return;
    const el = document.getElementById(READER_SCROLL_ID);
    if (!el) {
      setMdP(0);
      return;
    }
    const onScroll = () => setMdP(scrollPercentOf(el));
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [active?.id, active?.type]);

  const p = active?.type === "html" ? htmlScrollPercent : mdP;
  return Math.max(0, Math.min(100, p));
}
