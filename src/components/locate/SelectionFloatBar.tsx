"use client";

import * as React from "react";
import { Highlighter, LocateFixed } from "lucide-react";

export function SelectionFloatBar({
  rect,
  onLocate,
  onAnnotate,
}: {
  rect: { top: number; left: number; bottom: number; right: number };
  onLocate: () => void;
  /** Optional: create highlight annotation from current selection. */
  onAnnotate?: () => void;
}) {
  const mid = (rect.left + rect.right) / 2;
  const top = Math.max(8, rect.top - 40);

  return (
    <div
      className="fixed z-[70] flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--menu)] px-1.5 py-1 shadow-lg animate-enter font-ui"
      style={{
        left: mid,
        top,
        transform: "translateX(-50%)",
      }}
      role="toolbar"
      aria-label="选区操作"
    >
      <button
        type="button"
        aria-label="定位源码"
        title="在源码中定位"
        onClick={onLocate}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
      >
        <LocateFixed className="h-3.5 w-3.5" aria-hidden />
        定位源码
      </button>
      {onAnnotate && (
        <button
          type="button"
          aria-label="划线批注"
          title="划线并添加批注（不改正文）"
          onClick={onAnnotate}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--gold)] hover:bg-[color-mix(in_srgb,var(--gold)_14%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/50"
        >
          <Highlighter className="h-3.5 w-3.5" aria-hidden />
          划线批注
        </button>
      )}
    </div>
  );
}
