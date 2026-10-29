"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { listFolderPaths, parseFolderInput } from "@/lib/folders";

export type CreateFolderDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Default parent folder ("" = library root). */
  defaultParent: string;
  /** Called with the created (or already-existing) full path. */
  onCreated?: (fullPath: string) => void;
};

export function CreateFolderDialog({
  open,
  onClose,
  defaultParent,
  onCreated,
}: CreateFolderDialogProps) {
  const documents = useStore((s) => s.documents);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const createFolder = useStore((s) => s.createFolder);

  const [parent, setParent] = React.useState(defaultParent);
  const [pathInput, setPathInput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const folderOptions = React.useMemo(
    () => listFolderPaths(documents, emptyFolders),
    [documents, emptyFolders]
  );

  const preview = React.useMemo(() => {
    const parsed = parseFolderInput(pathInput, parent);
    if (!parsed.ok) return null;
    return parsed.fullPath;
  }, [pathInput, parent]);

  const submit = React.useCallback(() => {
    const parsed = parseFolderInput(pathInput, parent);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    const full = createFolder(pathInput, parent);
    if (!full) {
      setError(useStore.getState().status?.message || "创建失败");
      return;
    }
    onCreated?.(full);
    onClose();
  }, [pathInput, parent, createFolder, onCreated, onClose]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="create-folder-title">
      <div className="p-5 space-y-3">
        <h2 id="create-folder-title" className="font-serif text-lg font-semibold">
          新建文件夹
        </h2>

        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">位置</span>
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-ui text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
          >
            <option value="">库根目录</option>
            {folderOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">路径</span>
          <Input
            autoFocus
            value={pathInput}
            onChange={(e) => {
              setPathInput(e.target.value);
              setError(null);
            }}
            placeholder="算法/图论/最短路"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-xs font-mono text-[var(--muted)] break-all">
          {preview ? (
            <>
              将创建：<span className="text-[var(--fg)]">{preview}</span>
            </>
          ) : (
            "输入路径后显示完整库内路径"
          )}
        </div>

        {error ? (
          <p className="text-xs text-[var(--accent)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={submit}>
            创建
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
