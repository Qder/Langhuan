"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4" role="presentation">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl animate-enter",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
