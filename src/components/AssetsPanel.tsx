"use client";

import * as React from "react";
import { ImageIcon, ImagePlus, Trash2, Eraser } from "lucide-react";
import { useStore } from "@/lib/store";
import { basename, cn, relativeTime } from "@/lib/utils";
import { AssetImage } from "./editor/AssetImage";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { runLibraryImageUpload } from "@/lib/assets/runImageUpload";
import { findOrphanAssets } from "@/lib/assets/orphanAssets";

export function AssetsPanel({ docId }: { docId: string }) {
  const assetsForDoc = useStore((s) => s.assetsForDoc);
  const removeAsset = useStore((s) => s.removeAsset);
  const assets = assetsForDoc(docId);
  const allAssets = useStore((s) => s.assets);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const setStatus = useStore((s) => s.setStatus);
  const [open, setOpen] = React.useState(true);
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; name: string } | null>(
    null
  );
  const [orphanOpen, setOrphanOpen] = React.useState(false);
  const [orphanList, setOrphanList] = React.useState<
    { id: string; path: string; size: number }[]
  >([]);
  const [orphanBusy, setOrphanBusy] = React.useState(false);

  const docType = useStore((s) => s.documents.find((d) => d.id === docId)?.type);

  if (docType && docType !== "md" && !assets.length) return null;

  const scanOrphans = () => {
    const orphans = findOrphanAssets(documents, allAssets, (d) => getContent(d.id));
    setOrphanList(
      orphans.map((a) => ({ id: a.id, path: a.path, size: a.size }))
    );
    setOrphanOpen(true);
    if (orphans.length === 0) {
      setStatus("没有未引用的附件");
    } else {
      setStatus(`发现 ${orphans.length} 个未引用附件，请确认后清理`);
    }
  };

  const confirmOrphans = () => {
    setOrphanBusy(true);
    try {
      for (const a of orphanList) {
        removeAsset(a.id);
      }
      setStatus(`已清理 ${orphanList.length} 个未引用附件`);
      setOrphanOpen(false);
      setOrphanList([]);
    } finally {
      setOrphanBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)] hover:bg-[var(--hover)]"
        >
          <ImageIcon className="h-3 w-3" />
          附件 {assets.length}
        </button>
        {docType === "md" && (
          <button
            type="button"
            aria-label="上传图片"
            title="上传图片"
            className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--hover)]"
            onClick={() => {
              void runLibraryImageUpload({
                docId,
                insertAt: getContent(docId).length,
                style: "block",
              });
            }}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="清理未引用附件"
          title="清理未引用附件"
          className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--hover)]"
          onClick={scanOrphans}
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && assets.length > 0 && (
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
                onClick={() => setPendingDelete({ id: a.id, name: basename(a.path) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        labelledBy="asset-delete-title"
      >
        <div className="p-5 space-y-3">
          <h2 id="asset-delete-title" className="font-serif text-lg font-semibold">
            删除附件？
          </h2>
          <p className="text-sm text-[var(--muted)]">
            删除附件「{pendingDelete?.name}」？正文中的引用不会自动删除。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (pendingDelete) removeAsset(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              删除
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={orphanOpen}
        onClose={() => setOrphanOpen(false)}
        labelledBy="orphan-assets-title"
        className="max-w-md"
      >
        <div className="p-5 space-y-3">
          <h2 id="orphan-assets-title" className="font-serif text-lg font-semibold">
            清理未引用附件
          </h2>
          {orphanList.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">当前库内没有未引用的附件。</p>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">
                将删除下列 {orphanList.length} 个未被任何笔记引用的附件（不可自动恢复，请先备份）：
              </p>
              <ul className="max-h-48 overflow-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] text-xs">
                {orphanList.map((a) => (
                  <li key={a.id} className="px-2.5 py-1.5 flex justify-between gap-2">
                    <span className="truncate font-mono">{a.path}</span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {(a.size / 1024).toFixed(1)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOrphanOpen(false)}>
              取消
            </Button>
            <Button
              variant="accent"
              disabled={orphanBusy || orphanList.length === 0}
              onClick={confirmOrphans}
            >
              确认清理
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
