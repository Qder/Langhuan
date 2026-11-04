"use client";

import { titleOf } from "@/lib/utils";

/**
 * Ellipsis middle path segments; keep last two.
 * The final segment is the document title in serif, the rest stays muted UI.
 */
export function BreadcrumbPath({ path }: { path: string }) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  let shownDirs = dirs;
  let ellipsis = false;
  if (dirs.length > 2) {
    shownDirs = dirs.slice(-2);
    ellipsis = true;
  }
  return (
    <div className="min-w-0 truncate text-sm text-[var(--muted)] font-ui">
      {ellipsis && <span>… / </span>}
      {shownDirs.map((d, i) => (
        <span key={`${d}-${i}`}>
          {d}
          <span> / </span>
        </span>
      ))}
      <span className="font-serif font-bold text-[var(--fg)]">{titleOf(file)}</span>
    </div>
  );
}
