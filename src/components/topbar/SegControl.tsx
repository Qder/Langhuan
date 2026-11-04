"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** One pill inside a segmented control (reading popover + compact toolbar). */
export function SegButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "min-h-8 max-lg:min-h-10 px-2.5 max-lg:px-3 text-[11px] max-lg:text-xs rounded-[10px] font-ui transition-colors",
        active
          ? "bg-[var(--accent)] text-white"
          : "hover:bg-[var(--hover)] text-[var(--muted)]"
      )}
    >
      {children}
    </button>
  );
}

/** Labelled group wrapper for segmented pills. */
export function SegGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)] font-ui">
        {label}
      </div>
      <div
        className="inline-flex flex-wrap rounded-xl border border-[var(--border)] p-0.5 bg-[var(--bg)]"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}
