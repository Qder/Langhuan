"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = React.useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; minWidth: number } | null>(null);

  React.useEffect(() => setMounted(true), []);

  const updatePos = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const minWidth = Math.max(180, r.width);
    let left = align === "right" ? r.right - minWidth : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - minWidth - 8));
    const top = Math.min(r.bottom + 6, window.innerHeight - 8);
    setPos({ top, left, minWidth });
  }, [align]);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePos]);

  const menu =
    open && pos && mounted
      ? createPortal(
          <div
            ref={menuRef}
            className={cn(
              "fixed z-[90] rounded-2xl border border-[var(--border)] bg-[var(--menu)] p-1.5 shadow-xl animate-enter"
            )}
            style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
            role="menu"
          >
            <div onClick={() => setOpen(false)}>{children}</div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative inline-flex" ref={triggerRef}>
      <div
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) requestAnimationFrame(updatePos);
            return next;
          });
        }}
      >
        {trigger}
      </div>
      {menu}
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
