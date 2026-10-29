"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { basename } from "@/lib/utils";
import {
  isSelfOrDescendantFolder,
  listFolderPaths,
  sanitizeFolderSegment,
} from "@/lib/folders";

export function RenameFolderDialog({
  open,
  folderPath,
  onClose,
  onDone,
}: {
  open: boolean;
  folderPath: string;
  onClose: () => void;
  onDone?: (newPath: string) => void;
}) {
  const renameFolder = useStore((s) => s.renameFolder);
  const [name, setName] = React.useState(basename(folderPath));
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    const seg = sanitizeFolderSegment(name);
    if (!seg) {
      setError("文件夹名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）");
      return;
    }
    const result = renameFolder(folderPath, seg);
    if (!result) {
      setError(useStore.getState().status?.message || "重命名失败");
      return;
    }
    onDone?.(result);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="rename-folder-title">
      <div className="p-5 space-y-3">
        <h2 id="rename-folder-title" className="font-serif text-lg font-semibold">
          重命名文件夹
        </h2>
        <p className="text-xs text-[var(--muted)] font-mono break-all">{folderPath}</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">新名称（单段）</span>
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
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
            重命名
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function MoveFolderDialog({
  open,
  folderPath,
  onClose,
  onDone,
}: {
  open: boolean;
  folderPath: string;
  onClose: () => void;
  onDone?: (newPath: string) => void;
}) {
  const documents = useStore((s) => s.documents);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const moveFolder = useStore((s) => s.moveFolder);
  const [parent, setParent] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const folderOptions = React.useMemo(
    () =>
      listFolderPaths(documents, emptyFolders).filter(
        (p) => !isSelfOrDescendantFolder(folderPath, p)
      ),
    [documents, emptyFolders, folderPath]
  );

  const leaf = basename(folderPath);
  const preview = parent ? `${parent}/${leaf}` : leaf;

  const submit = () => {
    if (isSelfOrDescendantFolder(folderPath, parent)) {
      setError("不能将文件夹移入自身或其子目录");
      return;
    }
    const result = moveFolder(folderPath, parent);
    if (!result) {
      setError(useStore.getState().status?.message || "移动失败");
      return;
    }
    onDone?.(result);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="move-folder-title">
      <div className="p-5 space-y-3">
        <h2 id="move-folder-title" className="font-serif text-lg font-semibold">
          移动文件夹
        </h2>
        <p className="text-xs text-[var(--muted)] font-mono break-all">{folderPath}</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">移动到</span>
          <select
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
              setError(null);
            }}
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
        <div className="rounded-xl border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-xs font-mono text-[var(--muted)] break-all">
          目标：<span className="text-[var(--fg)]">{preview}</span>
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
            移动
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
