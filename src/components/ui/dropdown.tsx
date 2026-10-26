"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Dropdown({
  trigger,
  children,
  align = "left",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative inline-flex" ref={ref}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-1.5 z-50 min-w-[180px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-xl animate-enter",
            align === "right" ? "right-0" : "left-0"
          )}
          role="menu"
        >
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-ui transition-colors",
        danger ? "text-[var(--accent)] hover:bg-[var(--accent)]/10" : "hover:bg-[var(--hover)]",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      {children}
    </button>
  );
}
