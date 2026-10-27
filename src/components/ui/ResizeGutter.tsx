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
  /** Double-click / Enter reset (optional). */
  onReset?: () => void;
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
 *
 * onDelta is always invoked via a ref so rapid pointermove events see the
 * latest callback. Callers must still read live sizes (e.g. zustand
 * getState()) inside onDelta — React re-renders lag behind pointer events.
 */
export function ResizeGutter({
  axis = "horizontal",
  resolveAxis,
  onDelta,
  onReset,
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
  const onDeltaRef = React.useRef(onDelta);
  const onResetRef = React.useRef(onReset);

  React.useEffect(() => {
    onDeltaRef.current = onDelta;
  }, [onDelta]);
  React.useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  const getAxis = React.useCallback(
    () => (resolveAxis ? resolveAxis() : axis),
    [axis, resolveAxis]
  );

  const endDrag = React.useCallback((gutter: HTMLElement, pointerId?: number) => {
    dragging.current = false;
    delete gutter.dataset.active;
    document.documentElement.removeAttribute("data-lh-resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (typeof pointerId === "number") {
      try {
        gutter.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const ax = getAxis();
      activeAxis.current = ax;
      dragging.current = true;
      last.current = ax === "horizontal" ? e.clientX : e.clientY;
      const gutter = e.currentTarget;
      gutter.setPointerCapture(e.pointerId);
      gutter.dataset.active = "1";
      document.documentElement.setAttribute(
        "data-lh-resizing",
        ax === "horizontal" ? "col" : "row"
      );
      document.body.style.cursor = ax === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const pos = activeAxis.current === "horizontal" ? ev.clientX : ev.clientY;
        const delta = pos - last.current;
        last.current = pos;
        if (delta !== 0) onDeltaRef.current(delta, activeAxis.current);
      };

      const onUp = (ev: PointerEvent) => {
        endDrag(gutter, ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [disabled, getAxis, endDrag]
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
        onDeltaRef.current(min - value, ax);
        return;
      }
      if (e.key === "End" && typeof max === "number" && typeof value === "number") {
        e.preventDefault();
        onDeltaRef.current(max - value, ax);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && onResetRef.current) {
        e.preventDefault();
        onResetRef.current();
        return;
      }
      if (delta !== 0) {
        e.preventDefault();
        onDeltaRef.current(delta, ax);
      }
    },
    [disabled, getAxis, keyboardStep, min, max, value]
  );

  const orientation = axis === "horizontal" ? "vertical" : "horizontal";

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={typeof value === "number" ? Math.round(value) : undefined}
      aria-disabled={disabled || undefined}
      title={onReset ? `${label}（双击复位）` : label}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (disabled || !onResetRef.current) return;
        e.preventDefault();
        onResetRef.current();
      }}
      onKeyDown={onKeyDown}
      style={style}
      data-axis={axis}
      className={cn(
        "lh-resize-gutter group relative shrink-0 z-20 touch-none select-none",
        // N-langhuan-split-gutter: resting track solid enough on paper bg
        "bg-[var(--border)] hover:bg-[var(--accent)]/45",
        "focus-visible:outline-none focus-visible:bg-[var(--accent)]/55",
        "data-[active=1]:bg-[var(--accent)]/70",
        "transition-colors",
        "w-2 cursor-col-resize self-stretch",
        disabled && "pointer-events-none opacity-40",
        className
      )}
    >
      {/* Hit slop: receives events and bubbles to this separator */}
      <span aria-hidden className="lh-resize-gutter-hit absolute" />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full bg-[var(--accent)] transition-opacity z-[1]",
          // Resting mid-handle faintly visible; full on hover/drag
          "opacity-45 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[active=1]:opacity-100",
          "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "h-12 w-1"
        )}
      />
    </div>
  );
}
