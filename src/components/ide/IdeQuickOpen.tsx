"use client";

import * as React from "react";
import { FileCode2, Search } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { useIdeStore } from "@/lib/ide/store";
import {
  collectFileIndexWithOptionalBfs,
  collectScannedFileIndex,
} from "@/lib/ide/explain";
import { listIdeDir } from "@/lib/ide/ideFs";
import { planQuickOpenCandidates } from "@/lib/ide/quickOpen";
import { cn } from "@/lib/utils";

export function IdeQuickOpen({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const session = useIdeStore((s) => s.session);
  const children = useIdeStore((s) => s.children);
  const tabs = useIdeStore((s) => s.tabs);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);

  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const [fileIndex, setFileIndex] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 20);

    if (!session) {
      setFileIndex([]);
      setStatus("先打开文件夹");
      return;
    }

    let cancelled = false;
    setLoading(true);
    const scanned = collectScannedFileIndex(children);
    setFileIndex(scanned);
    void collectFileIndexWithOptionalBfs({
      session,
      children,
      listDir: listIdeDir,
    }).then((paths) => {
      if (cancelled) return;
      setFileIndex(paths);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, session, children, setStatus]);

  const tabPaths = React.useMemo(() => tabs.map((t) => t.path), [tabs]);
  const items = React.useMemo(
    () =>
      planQuickOpenCandidates({
        query: q,
        fileIndex,
        tabPaths,
      }),
    [q, fileIndex, tabPaths]
  );

  React.useEffect(() => {
    setIdx(0);
  }, [q, items.length]);

  const pick = async (path: string) => {
    onClose();
    const ok = await openFile(path);
    if (!ok) setStatus(`打不开 ${path}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setIdx((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setIdx((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = items[idx];
      if (hit) void pick(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="ide-quick-open-title" className="max-w-xl p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
        <Search className="h-4 w-4 text-[var(--muted)] shrink-0" />
        <input
          ref={inputRef}
          id="ide-quick-open-title"
          className="flex-1 bg-transparent text-sm font-ui outline-none placeholder:text-[var(--muted)]"
          placeholder={session ? "打开文件…" : "先打开文件夹"}
          value={q}
          disabled={!session}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="快速打开文件"
        />
        {loading && session && (
          <span className="text-[11px] text-[var(--muted)] font-ui shrink-0">扫描…</span>
        )}
      </div>
      <div className="max-h-[min(50vh,320px)] overflow-y-auto py-1" role="listbox">
        {!session && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">先打开文件夹</div>
        )}
        {session && items.length === 0 && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">
            {q.trim() ? "无匹配文件" : "没有打开的标签；输入路径过滤工程文件"}
          </div>
        )}
        {items.map((p, i) => {
          const leaf = p.split("/").pop() || p;
          return (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={i === idx}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm font-ui",
                i === idx ? "bg-[var(--accent)]/12 text-[var(--accent)]" : "hover:bg-[var(--hover)]"
              )}
              onMouseEnter={() => setIdx(i)}
              onClick={() => void pick(p)}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="truncate font-medium">{leaf}</span>
              <span className="truncate text-[11px] text-[var(--muted)] ml-auto pl-2">{p}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
