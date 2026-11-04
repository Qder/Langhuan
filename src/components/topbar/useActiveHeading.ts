"use client";

import * as React from "react";
import {
  headingViewportTops,
  measureHeadingContentTops,
  OUTLINE_SPY_THRESHOLD_PX,
  resolveActiveHeadingId,
  type HeadingContentTop,
} from "@/lib/outline";

/**
 * Active-heading spy for the 目录 popover.
 *
 * Reads the same `#reader-scroll` root the MD reader scrolls, caches heading
 * offsets until the article resizes (async images / mermaid), and throttles to
 * one rAF per scroll. Returns `""` when there is nothing to spy on, which is
 * what the popover showed before the split.
 *
 * `wide` is part of the dependency contract: on desktop the rail renders the
 * outline instead, so the popover only needs to track while it is closed.
 */
export function useActiveHeading({
  enabled,
  wide,
  docId,
}: {
  enabled: boolean;
  wide: boolean;
  docId?: string;
}): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [activeHeading, setActiveHeading] = React.useState("");
  const cacheRef = React.useRef<HeadingContentTop[] | null>(null);

  React.useEffect(() => {
    if (!enabled && wide) return;
    const root = document.getElementById("reader-scroll");
    if (!root) return;
    cacheRef.current = null;
    let raf = 0;
    const ensureHeads = () => {
      if (cacheRef.current) return cacheRef.current;
      const article = root.querySelector("article");
      const scope = (article as HTMLElement | null) ?? root;
      const measured = measureHeadingContentTops(root, scope);
      cacheRef.current = measured;
      return measured;
    };
    const update = () => {
      raf = 0;
      const cached = ensureHeads();
      const rootTop = root.getBoundingClientRect().top;
      const heads = headingViewportTops(cached, root.scrollTop, rootTop);
      const current = resolveActiveHeadingId(heads, OUTLINE_SPY_THRESHOLD_PX);
      setActiveHeading((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    // Invalidate when article size changes (async images/mermaid)
    const article = root.querySelector("article");
    const ro =
      typeof ResizeObserver !== "undefined" && article
        ? new ResizeObserver(() => {
            cacheRef.current = null;
          })
        : null;
    if (ro && article) ro.observe(article);
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled, wide, docId]);

  return [activeHeading, setActiveHeading];
}
