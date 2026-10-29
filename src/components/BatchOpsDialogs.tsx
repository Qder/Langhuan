"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { listFolderPaths } from "@/lib/folders";

export function MoveDocsDialog({
  open,
  docIds,
  onClose,
}: {
  open: boolean;
  docIds: string[];
  onClose: () => void;
}) {
  const documents = useStore((s) => s.documents);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const moveDocsToFolder = useStore((s) => s.moveDocsToFolder);
  const [parent, setParent] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const selectRef = React.useRef<HTMLSelectElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setParent("");
    setError(null);
    const t = window.setTimeout(() => selectRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const folderOptions = React.useMemo(
    () => listFolderPaths(documents, emptyFolders),
    [documents, emptyFolders]
  );

  const submit = () => {
    if (!docIds.length) {
      setError("未选中文档");
      return;
    }
    setError(null);
    moveDocsToFolder(docIds, parent.trim());
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="move-docs-title">
      <div className="p-5 space-y-3">
        <h2 id="move-docs-title" className="font-serif text-lg font-semibold">
          移动文档
        </h2>
        <p className="text-xs text-[var(--muted)]">
          已选 {docIds.length} 篇 · 选库根则移到根目录
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">移动到</span>
          <select
            ref={selectRef}
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
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
          目标：
          <span className="text-[var(--fg)]">{parent || "（库根）"}</span>
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

export function AddTagsDialog({
  open,
  docIds,
  onClose,
}: {
  open: boolean;
  docIds: string[];
  onClose: () => void;
}) {
  const batchSetTags = useStore((s) => s.batchSetTags);
  const [raw, setRaw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRaw("");
    setError(null);
  }, [open]);

  const submit = () => {
    const tags = raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tags.length) {
      setError("请输入至少一个标签（逗号分隔）");
      return;
    }
    if (!docIds.length) {
      setError("未选中文档");
      return;
    }
    setError(null);
    batchSetTags(docIds, tags, "add");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="add-tags-title">
      <div className="p-5 space-y-3">
        <h2 id="add-tags-title" className="font-serif text-lg font-semibold">
          添加标签
        </h2>
        <p className="text-xs text-[var(--muted)]">为已选 {docIds.length} 篇追加标签</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">标签（逗号分隔）</span>
          <Input
            autoFocus
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            placeholder="算法, 图论"
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
            添加
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function SaveSearchDialog({
  open,
  query,
  defaultName,
  onClose,
}: {
  open: boolean;
  query: string;
  defaultName: string;
  onClose: () => void;
}) {
  const addSavedSearch = useStore((s) => s.addSavedSearch);
  const setStatus = useStore((s) => s.setStatus);
  const [name, setName] = React.useState(defaultName);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setError(null);
  }, [open, defaultName]);

  const submit = () => {
    const n = name.trim();
    if (!n) {
      setError("请输入名称");
      return;
    }
    const q = query.trim();
    if (!q) {
      setError("查询为空");
      return;
    }
    setError(null);
    addSavedSearch(n, q);
    setStatus(`已保存搜索「${n}」`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="save-search-title">
      <div className="p-5 space-y-3">
        <h2 id="save-search-title" className="font-serif text-lg font-semibold">
          保存常用搜索
        </h2>
        <p className="text-xs text-[var(--muted)] font-mono break-all">查询：{query}</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">名称</span>
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="为常用搜索命名"
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
            保存
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
