"use client";

import * as React from "react";
import { DocAside, type DocAsideProps } from "../DocAside";
import type { Document } from "@/lib/types";

/**
 * 目录 popover — the compact outline used when the rail is hidden (or below lg).
 * Positioned under the header's right cluster, same offset as before the split.
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
      className="absolute right-3 top-full z-40 mt-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl animate-enter"
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
