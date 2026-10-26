"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Axis = "horizontal" | "vertical";

export type ResizeGutterProps = {
  /** horizontal = left/right panes (col-resize); vertical = top/bottom (row-resize) */
  axis?: Axis;
  /**
   * If set, axis is resolved on each pointer/keyboard interaction
   * (e.g. read container flex-direction for responsive split).
   */
  resolveAxis?: () => Axis;
  /** Called with delta in CSS pixels along the active axis (positive = toward end). */
  onDelta: (deltaPx: number, axis: Axis) => void;
  /** Optional keyboard step in px (default 16; Shift = 48). */
  keyboardStep?: number;
  /** Current value for aria-valuenow (optional). */
  value?: number;
  min?: number;
  max?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
};

/**
 * Thin resizable gutter with 朱砂 hover/active accent.
 * Parent owns size state; this only reports pointer/keyboard deltas.
 */
export function ResizeGutter({
  axis = "horizontal",
  resolveAxis,
  onDelta,
  keyboardStep = 16,
  value,
  min,
  max,
  label = "调整大小",
  className,
  style,
  disabled,
}: ResizeGutterProps) {
  const dragging = React.useRef(false);
  const last = React.useRef(0);
  const activeAxis = React.useRef<Axis>(axis);

  const getAxis = React.useCallback(
    () => (resolveAxis ? resolveAxis() : axis),
    [axis, resolveAxis]
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      const ax = getAxis();
      activeAxis.current = ax;
      dragging.current = true;
      last.current = ax === "horizontal" ? e.clientX : e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
      const gutter = e.currentTarget;
      gutter.dataset.active = "1";
      document.body.style.cursor = ax === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const pos = activeAxis.current === "horizontal" ? ev.clientX : ev.clientY;
        const delta = pos - last.current;
        last.current = pos;
        if (delta !== 0) onDelta(delta, activeAxis.current);
      };

      const onUp = (ev: PointerEvent) => {
        dragging.current = false;
        delete gutter.dataset.active;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          gutter.releasePointerCapture(ev.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [disabled, getAxis, onDelta]
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const ax = getAxis();
      const step = e.shiftKey ? keyboardStep * 3 : keyboardStep;
      let delta = 0;
      if (ax === "horizontal") {
        if (e.key === "ArrowLeft") delta = -step;
        else if (e.key === "ArrowRight") delta = step;
      } else {
        if (e.key === "ArrowUp") delta = -step;
        else if (e.key === "ArrowDown") delta = step;
      }
      if (e.key === "Home" && typeof min === "number" && typeof value === "number") {
        e.preventDefault();
        onDelta(min - value, ax);
        return;
      }
      if (e.key === "End" && typeof max === "number" && typeof value === "number") {
        e.preventDefault();
        onDelta(max - value, ax);
        return;
      }
      if (delta !== 0) {
        e.preventDefault();
        onDelta(delta, ax);
      }
    },
    [disabled, getAxis, keyboardStep, min, max, onDelta, value]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={typeof value === "number" ? Math.round(value) : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        "group relative shrink-0 z-10 touch-none",
        "bg-[var(--border)]/55 hover:bg-[var(--accent)]/45",
        "focus-visible:outline-none focus-visible:bg-[var(--accent)]/55",
        "data-[active=1]:bg-[var(--accent)]/60",
        "transition-colors",
        "w-1.5 cursor-col-resize self-stretch",
        disabled && "pointer-events-none opacity-40",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full bg-[var(--accent)] opacity-0 transition-opacity",
          "group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[active=1]:opacity-100",
          "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "h-8 w-1"
        )}
      />
    </div>
  );
}
