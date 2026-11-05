"use client";

import * as React from "react";
import { DocAside, type DocAsideProps } from "../DocAside";
import type { Document } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 目录 popover — the compact outline used when the rail is hidden (or below lg).
 *
 * Must NOT rely on `absolute` inside the TopBar `<header>`: that header uses
 * `overflow-hidden` (breadcrumb truncation), so an absolute panel that drops
 * `top-full` is clipped and ends up painting under the reader body on
 * Android / narrow WebView. Mirror ReadingPopover: `fixed` to the viewport
 * with a z-index above main chrome.
 */
export function TocPopover({
  open,
  panelRef,
  doc,
  outline,
  backlinks,
  activeHeading,
  onNavigateHeading,
}: {
  open: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  doc: Document;
  outline: DocAsideProps["outline"];
  backlinks: Document[];
  activeHeading: string;
  onNavigateHeading: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <div
      ref={panelRef}
      data-toc-popover=""
      className={cn(
        "fixed z-[70] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl animate-enter",
        // Pin under the 3.5rem header; keep clear of the bottom chrome.
        "left-2 right-2 top-[3.75rem] max-h-[calc(100dvh-5rem)] overflow-y-auto",
        // Tablet+: right-aligned compact card (same width DocAside popover uses).
        "sm:left-auto sm:right-3 sm:w-[min(280px,80vw)]"
      )}
    >
      <DocAside
        outline={outline}
        backlinks={backlinks}
        activeHeading={activeHeading}
        variant="popover"
        doc={doc}
        onNavigateHeading={onNavigateHeading}
      />
    </div>
  );
}
