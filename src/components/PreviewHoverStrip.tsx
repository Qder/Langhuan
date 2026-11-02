"use client";

import * as React from "react";
import { useStore } from "@/lib/store";

/**
 * Thin non-interactive strip at the top of the MD/HTML preview column.
 * Shows 「源码 L12–L18」 (or degrade copy) while hovering a mapped node.
 * pointer-events: none so it never steals click locate.
 */
export function PreviewHoverStrip() {
  const hoverReveal = useStore((s) => s.hoverReveal);
  if (!hoverReveal) return null;

  const text = hoverReveal.degrade
    ? hoverReveal.message || "动态生成，无稳定源码行号"
    : hoverReveal.label
      ? `源码 ${hoverReveal.label}`
      : null;
  if (!text) return null;

  return (
    <div
      data-testid="preview-hover-strip"
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
    >
      <div className="mt-1 max-w-[min(100%,28rem)] truncate rounded-full border border-[var(--border)] bg-[var(--chrome)]/92 px-3 py-0.5 text-[10px] tabular-nums text-[var(--muted)] shadow-sm backdrop-blur-sm font-ui">
        {text}
      </div>
    </div>
  );
}
