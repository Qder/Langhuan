"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
};

export function PreviewContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[focusIdx]?.onSelect();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [items, focusIdx, onClose]);

  React.useEffect(() => {
    ref.current?.querySelectorAll('[role="menuitem"]')[focusIdx]?.scrollIntoView({ block: "nearest" });
  }, [focusIdx]);

  // keep on screen
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - items.length * 40 - 16),
    zIndex: 80,
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="预览选区菜单"
      style={style}
      className="min-w-[200px] rounded-2xl border border-[var(--border)] bg-[var(--menu)] p-1.5 shadow-xl animate-enter font-ui"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
            item.danger ? "text-[var(--accent)]" : "",
            i === focusIdx ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
          )}
          onMouseEnter={() => setFocusIdx(i)}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="text-xs text-[var(--muted)] font-mono">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
