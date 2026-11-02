"use client";

import * as React from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import type { TrashItem } from "@/lib/types";
import { relativeTime, titleOf } from "@/lib/utils";
import { trashPreviewBody, trashPreviewMeta } from "@/lib/trashPreview";

/**
 * 回收站条目预览：标题 / 原路径 / 删除时间 / 正文截断（不跑 HTML 脚本）。
 */
export function TrashPreviewDialog({
  item,
  onClose,
  onRestore,
  onPurge,
}: {
  item: TrashItem | null;
  onClose: () => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  if (!item) return null;
  const meta = trashPreviewMeta(item);
  const body = trashPreviewBody(item.doc.content, item.doc.type);

  return (
    <Dialog open={!!item} onClose={onClose} className="max-w-2xl" labelledBy="trash-preview-title">
      <div className="flex items-start gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="trash-preview-title" className="m-0 truncate text-base font-medium text-[var(--fg)]">
            {titleOf(item.doc.path) || meta.title}
          </h2>
          <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{meta.path}</p>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            删除于 {relativeTime(meta.deletedAt)}
            <span className="mx-1 opacity-50">·</span>
            {new Date(meta.deletedAt).toLocaleString("zh-CN", { hour12: false })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X className="h-4 w-4 text-[var(--muted)]" />
        </button>
      </div>

      <div className="max-h-[50vh] overflow-auto px-4 py-3">
        {body.kind === "empty" ? (
          <p className="text-sm text-[var(--muted)]">{body.message}</p>
        ) : (
          <pre
            className={
              body.kind === "md"
                ? "prose-langhuan m-0 whitespace-pre-wrap break-words font-body text-sm leading-relaxed text-[var(--fg)]"
                : "m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--fg)]"
            }
          >
            {body.text}
          </pre>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        <Button
          variant="outline"
          onClick={() => {
            onRestore(item.doc.id);
            onClose();
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> 恢复
        </Button>
        <Button
          variant="outline"
          className="text-[var(--accent)]"
          onClick={() => onPurge(item.doc.id)}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> 彻底删除
        </Button>
      </div>
    </Dialog>
  );
}
