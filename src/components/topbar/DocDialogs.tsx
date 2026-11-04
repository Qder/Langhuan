"use client";

import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { titleOf } from "@/lib/utils";
import type { Document } from "@/lib/types";

/** 重命名 / 移动 — path-based rename, `/` creates a directory. */
export function RenameDialog({
  open,
  value,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="rename-title">
      <div className="p-5 space-y-3">
        <h2 id="rename-title" className="font-serif text-lg font-semibold">
          重命名 / 移动
        </h2>
        <p className="text-sm text-[var(--muted)]">
          路径里写 <code className="font-mono">/</code> 即可换目录，例如{" "}
          <code className="font-mono">笔记/新名字.md</code>
        </p>
        <Input value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={onConfirm}>
            确定
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** 移入回收站 confirmation. */
export function DeleteDialog({
  open,
  doc,
  onClose,
  onConfirm,
}: {
  open: boolean;
  doc: Document | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="delete-title">
      <div className="p-5 space-y-3">
        <h2 id="delete-title" className="font-serif text-lg font-semibold">
          移入回收站？
        </h2>
        <p className="text-sm text-[var(--muted)]">
          将「{doc ? titleOf(doc.path) : ""}」移入回收站，可在 30 天内恢复。
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={onConfirm}>
            删除
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
