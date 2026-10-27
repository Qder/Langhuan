"use client";

import * as React from "react";
import { ImageIcon, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { basename, cn, relativeTime } from "@/lib/utils";
import { AssetImage } from "./editor/AssetImage";

export function AssetsPanel({ docId }: { docId: string }) {
  const assetsForDoc = useStore((s) => s.assetsForDoc);
  const removeAsset = useStore((s) => s.removeAsset);
  const assets = assetsForDoc(docId);
  const [open, setOpen] = React.useState(true);

  if (!assets.length) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)] hover:bg-[var(--hover)]"
      >
        <ImageIcon className="h-3 w-3" />
        附件 {assets.length}
      </button>
      {open && (
        <ul className="mt-1 space-y-1.5">
          {assets.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-[var(--border)]",
                "bg-[var(--card)] px-2 py-1.5"
              )}
            >
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-[var(--hover)]">
                <AssetImage assetId={a.id} path={a.path} className="h-full w-full object-cover" alt="" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{basename(a.path)}</div>
                <div className="truncate text-[10px] text-[var(--muted)]">
                  {(a.size / 1024).toFixed(1)} KB · {relativeTime(a.createdAt)}
                </div>
              </div>
              <button
                type="button"
                aria-label="删除附件"
                className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--hover)]"
                onClick={() => {
                  if (confirm(`删除附件 ${basename(a.path)}？正文中的引用不会自动删除。`)) {
                    removeAsset(a.id);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
