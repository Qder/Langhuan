"use client";

import * as React from "react";
import { ChevronDown, Folder } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import {
  formatImportStatus,
  importPreviewLabel,
  rewriteImportPaths,
} from "@/lib/importPaths";
import { buildTree, type FolderTreeNode } from "@/lib/folders";
import { cn } from "@/lib/utils";

export type PendingImportDoc = { path: string; content: string };
export type PendingImportAsset = { path: string; blob: Blob; mime: string };

function FolderPickNode({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  customActive,
  onSelect,
}: {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string;
  customActive: boolean;
  onSelect: (path: string) => void;
}) {
  const folders = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh")
  );
  if (!folders.length) return null;

  return (
    <>
      {folders.map((f) => {
        const open = expanded.has(f.path);
        const hasKids = f.children.size > 0;
        const isSelected = !customActive && selected === f.path;
        return (
          <div key={f.path}>
            <div
              className={cn(
                "flex w-full items-center gap-0.5 rounded-lg text-sm transition-colors",
                isSelected
                  ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                  : "hover:bg-[var(--hover)]"
              )}
              style={{ paddingLeft: 4 + depth * 12 }}
            >
              <button
                type="button"
                className={cn(
                  "shrink-0 p-1 rounded hover:bg-[var(--hover)]",
                  !hasKids && "invisible pointer-events-none"
                )}
                aria-label={open ? "折叠" : "展开"}
                aria-expanded={hasKids ? open : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(f.path);
                }}
              >
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-[var(--muted)] transition-transform",
                    !open && "-rotate-90"
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 text-left font-mono"
              >
                <Folder className="h-4 w-4 shrink-0 opacity-70" />
                <span className="truncate">{f.name}</span>
              </button>
            </div>
            {open && hasKids && (
              <FolderPickNode
                node={f}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selected={selected}
                customActive={customActive}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function ImportFolderDialog({
  open,
  files,
  assets = null,
  onClose,
}: {
  open: boolean;
  files: PendingImportDoc[] | null;
  assets?: PendingImportAsset[] | null;
  onClose: () => void;
}) {
  const documents = useStore((s) => s.documents);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const importFiles = useStore((s) => s.importFiles);
  const importAssets = useStore((s) => s.importAssets);
  const setStatus = useStore((s) => s.setStatus);
  const tree = React.useMemo(
    () =>
      buildTree(
        documents.map((d) => ({
          id: d.id,
          path: d.path,
          type: d.type,
          starred: d.starred,
        })),
        emptyFolders
      ),
    [documents, emptyFolders]
  );
  const [selected, setSelected] = React.useState<string>(""); // "" = 库根目录
  const [custom, setCustom] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSelected("");
      setCustom("");
      setExpanded(new Set());
      setBusy(false);
    }
  }, [open]);

  const customActive = !!custom.trim();
  const target = custom.trim() || selected;
  const list = files || [];
  const assetList = assets || [];
  const canImport = list.length > 0 || assetList.length > 0;

  const onSelectFolder = (path: string) => {
    setSelected(path);
    setCustom("");
  };

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const confirm = async () => {
    if (!canImport) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const rewrittenDocs = rewriteImportPaths(list, target || undefined);
      const rewrittenAssets = rewriteImportPaths(assetList, target || undefined);
      const n = importFiles(rewrittenDocs, { quiet: true });
      const m = await importAssets(rewrittenAssets, { quiet: true });
      setStatus(formatImportStatus(n, m));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="import-folder-title" className="max-w-md">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="import-folder-title" className="font-serif text-lg font-semibold">
            导入到…
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {importPreviewLabel(list, assetList.length)}
          </p>
        </div>

        <div
          className="space-y-0.5 max-h-56 overflow-y-auto scroll-thin rounded-xl border border-[var(--border)] p-1.5"
          role="tree"
          aria-label="选择目标文件夹"
        >
          <button
            type="button"
            role="treeitem"
            aria-selected={!customActive && selected === ""}
            onClick={() => onSelectFolder("")}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors",
              !customActive && selected === ""
                ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                : "hover:bg-[var(--hover)]"
            )}
          >
            <Folder className="h-4 w-4 shrink-0 opacity-70" />
            库根目录
          </button>
          <FolderPickNode
            node={tree}
            depth={0}
            expanded={expanded}
            onToggle={onToggle}
            selected={selected}
            customActive={customActive}
            onSelect={onSelectFolder}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="import-new-folder" className="text-xs text-[var(--muted)]">
            或输入新路径
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
                void confirm();
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="accent"
            onClick={() => void confirm()}
            disabled={!canImport || busy}
          >
            导入
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
