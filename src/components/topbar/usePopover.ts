"use client";

import * as React from "react";

/**
 * Click-outside + Escape dismissal for the header's anchored panels.
 *
 * The trigger and the panel are separate refs on purpose: the panels are
 * absolutely positioned siblings, so "outside" must exclude both. Same
 * listeners the three hand-rolled popovers used before the split.
 */
export function usePopover() {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = React.useCallback(() => setOpen((v) => !v), []);

  return { open, setOpen, toggle, buttonRef, panelRef };
}
