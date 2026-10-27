"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export function PreviewContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel = "上下文菜单",
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const enabledIdxs = React.useMemo(
    () => items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0),
    [items]
  );
  const [focusIdx, setFocusIdx] = React.useState(() => enabledIdxs[0] ?? 0);

  React.useEffect(() => {
    setFocusIdx(enabledIdxs[0] ?? 0);
  }, [enabledIdxs]);

  React.useEffect(() => {
    const moveFocus = (dir: 1 | -1) => {
      if (!enabledIdxs.length) return;
      const pos = enabledIdxs.indexOf(focusIdx);
      const nextPos =
        pos < 0
          ? dir === 1
            ? 0
            : enabledIdxs.length - 1
          : (pos + dir + enabledIdxs.length) % enabledIdxs.length;
      setFocusIdx(enabledIdxs[nextPos]!);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusIdx];
        if (!item || item.disabled) return;
        item.onSelect();
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
  }, [items, focusIdx, onClose, enabledIdxs]);

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
      aria-label={ariaLabel}
      style={style}
      className="min-w-[200px] rounded-2xl border border-[var(--border)] bg-[var(--menu)] p-1.5 shadow-xl animate-enter font-ui"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-disabled={item.disabled || undefined}
          disabled={item.disabled}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
            item.danger && !item.disabled ? "text-[var(--accent)]" : "",
            item.disabled
              ? "cursor-not-allowed opacity-40 text-[var(--muted)]"
              : i === focusIdx
                ? "bg-[var(--hover)]"
                : "hover:bg-[var(--hover)]"
          )}
          onMouseEnter={() => {
            if (!item.disabled) setFocusIdx(i);
          }}
          onClick={() => {
            if (item.disabled) return;
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
