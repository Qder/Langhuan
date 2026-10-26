"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  content,
  children,
  side = "bottom",
}: {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--fg)] px-2 py-1 text-[11px] text-[var(--bg)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        )}
      >
        {content}
      </span>
    </span>
  );
}
