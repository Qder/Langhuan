"use client";

import * as React from "react";
import { Folder } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { collectFolders, importPreviewLabel, rewriteImportPaths } from "@/lib/importPaths";
import { cn } from "@/lib/utils";

type Pending = { path: string; content: string }[];

export function ImportFolderDialog({
  open,
  files,
  onClose,
}: {
  open: boolean;
  files: Pending | null;
  onClose: () => void;
}) {
  const documents = useStore((s) => s.documents);
  const importFiles = useStore((s) => s.importFiles);
  const folders = React.useMemo(
    () => collectFolders(documents.map((d) => d.path)),
    [documents]
  );
  const [selected, setSelected] = React.useState<string>(""); // "" = 库根目录
  const [custom, setCustom] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSelected("");
      setCustom("");
    }
  }, [open]);

  const target = custom.trim() || selected;
  const list = files || [];

  const confirm = () => {
    if (!list.length) {
      onClose();
      return;
    }
    const rewritten = rewriteImportPaths(list, target || undefined);
    importFiles(rewritten);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="import-folder-title" className="max-w-md">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="import-folder-title" className="font-serif text-lg font-semibold">
            导入到…
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{importPreviewLabel(list)}</p>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto scroll-thin rounded-xl border border-[var(--border)] p-1.5">
          <button
            type="button"
            onClick={() => {
              setSelected("");
              setCustom("");
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors",
              !custom.trim() && selected === ""
                ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                : "hover:bg-[var(--hover)]"
            )}
          >
            <Folder className="h-4 w-4 shrink-0 opacity-70" />
            库根目录
          </button>
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setSelected(f);
                setCustom("");
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left font-mono transition-colors",
                !custom.trim() && selected === f
                  ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                  : "hover:bg-[var(--hover)]"
              )}
            >
              <Folder className="h-4 w-4 shrink-0 opacity-70" />
              {f}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="import-new-folder" className="text-xs text-[var(--muted)]">
            或输入新文件夹路径
          </label>
          <Input
            id="import-new-folder"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="例如：笔记/算法"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirm();
              }
            }}
          />
        </div>

        {target ? (
          <p className="text-xs text-[var(--muted)] font-mono truncate">
            目标：{target}/…
          </p>
        ) : (
          <p className="text-xs text-[var(--muted)]">目标：库根目录</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={confirm} disabled={!list.length}>
            导入
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
