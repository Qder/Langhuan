"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { useIdeStore } from "@/lib/ide/store";
import { listIdeDir, readIdeFile } from "@/lib/ide/ideFs";
import {
  searchWorkspace,
  workspaceSearchIo,
  type WorkspaceSearchHit,
  type WorkspaceSearchResult,
} from "@/lib/ide/workspaceSearch";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; scanned: number; hits: number }
  | { kind: "done"; result: WorkspaceSearchResult }
  | { kind: "error"; message: string };

const EMPTY_HINT = "输入关键词，在当前工程里只读搜索";

/**
 * 工程内搜索 (Mod+Shift+F). Read-only, bounded, no index service.
 * Clicking a hit opens the file and jumps to the line.
 */
export function IdeWorkspaceSearch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="ide-ws-search-title"
      className="max-w-2xl p-0 overflow-hidden"
    >
      {/* 每次打开都挂一个新的搜索框：空关键词 / idle / 选中第一行就是 useState
          的初始值，所以「打开即清空」不需要 effect 里 setState。收起来时整个
          body 卸载，未跑完的扫描也跟着取消。 */}
      {open && <WorkspaceSearchBody onClose={onClose} />}
    </Dialog>
  );
}

function WorkspaceSearchBody({ onClose }: { onClose: () => void }) {
  const session = useIdeStore((s) => s.session);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);

  const [q, setQ] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const runRef = React.useRef(0);
  const cancelRef = React.useRef<{ cancelled: boolean } | null>(null);

  const cancelActive = React.useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    cancelRef.current = null;
  }, []);

  // 只做聚焦（DOM 副作用），不写任何 state：清空交给挂载时的初始值。
  React.useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(t);
      cancelActive();
    };
  }, [cancelActive]);

  const run = React.useCallback(
    async (raw: string) => {
      const query = raw.trim();
      const runId = ++runRef.current;
      cancelActive();
      if (!query) {
        setPhase({ kind: "idle" });
        return;
      }
      if (!session) {
        setPhase({ kind: "error", message: "先在读码打开一个工程" });
        return;
      }
      const signal = { cancelled: false };
      cancelRef.current = signal;
      setPhase({ kind: "scanning", scanned: 0, hits: 0 });
      try {
        const result = await searchWorkspace({
          query,
          io: workspaceSearchIo(session, listIdeDir, readIdeFile),
          signal,
          onProgress: ({ scanned, hits }) => {
            if (runRef.current !== runId) return;
            setPhase({ kind: "scanning", scanned, hits });
          },
        });
        if (runRef.current !== runId) return;
        setPhase({ kind: "done", result });
        setIdx(0);
      } catch (e) {
        if (runRef.current !== runId) return;
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (cancelRef.current === signal) cancelRef.current = null;
      }
    },
    [cancelActive, session]
  );

  // Debounced search as you type; Enter searches immediately.
  React.useEffect(() => {
    const t = window.setTimeout(() => void run(q), 320);
    return () => window.clearTimeout(t);
  }, [q, run]);

  const hits: WorkspaceSearchHit[] =
    phase.kind === "done" ? phase.result.hits : [];

  const pick = async (hit: WorkspaceSearchHit) => {
    onClose();
    const ok = await openFile(hit.path, { line: hit.line });
    if (!ok) setStatus(`打不开 ${hit.path}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!hits.length) return;
      setIdx((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      setIdx((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[idx];
      if (hit) void pick(hit);
      else void run(q);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
        <Search className="h-4 w-4 text-[var(--muted)] shrink-0" />
        <input
          ref={inputRef}
          id="ide-ws-search-title"
          className="flex-1 bg-transparent text-sm font-ui outline-none placeholder:text-[var(--muted)]"
          placeholder={
            session ? "在工程中搜索…（支持 re: 正则）" : "先打开文件夹"
          }
          value={q}
          disabled={!session}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="工程内搜索"
        />
        {phase.kind === "scanning" && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--muted)] font-ui shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            已扫 {phase.scanned} 个文件
          </span>
        )}
      </div>

      <div className="max-h-[min(55vh,380px)] overflow-y-auto py-1" role="listbox">
        {!session && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">
            先在读码打开一个工程
          </div>
        )}
        {session && phase.kind === "idle" && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">
            {EMPTY_HINT}
          </div>
        )}
        {session && phase.kind === "error" && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">
            搜索失败：{phase.message}
          </div>
        )}
        {session && phase.kind === "scanning" && hits.length === 0 && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            扫描中…
          </div>
        )}
        {phase.kind === "done" && hits.length === 0 && (
          <div className="px-3 py-4 text-sm text-[var(--muted)] font-ui">
            没有匹配。已扫 {phase.result.scannedFiles} 个文件
            {phase.result.skippedFiles > 0
              ? `，跳过 ${phase.result.skippedFiles} 个`
              : ""}
            。
          </div>
        )}
        {hits.map((hit, i) => (
          <button
            key={`${hit.path}:${hit.line}:${i}`}
            type="button"
            role="option"
            aria-selected={i === idx}
            className={cn(
              "w-full px-3 py-1.5 text-left",
              i === idx ? "bg-[var(--accent)]/12" : "hover:bg-[var(--hover)]"
            )}
            onMouseEnter={() => setIdx(i)}
            onClick={() => void pick(hit)}
          >
            <div className="flex items-baseline gap-2 text-[12px] font-ui">
              <span className="truncate text-[var(--fg)]">{hit.path}</span>
              <span className="shrink-0 text-[11px] text-[var(--muted)] tabular-nums">
                L{hit.line}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] font-mono text-[var(--muted)]">
              {hit.context.slice(0, Math.max(0, hit.matchStart))}
              <span className="rounded-sm bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] text-[var(--fg)]">
                {hit.context.slice(
                  hit.matchStart,
                  hit.matchStart + hit.matchLength
                )}
              </span>
              {hit.context.slice(hit.matchStart + hit.matchLength)}
            </div>
          </button>
        ))}
      </div>

      {phase.kind === "done" && hits.length > 0 && (
        <div className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)] font-ui flex items-center justify-between gap-2">
          <span>
            {phase.result.hits.length} 处 · 已扫 {phase.result.scannedFiles} 个文件
          </span>
          {phase.result.truncated && <span>已截断（结果较多）</span>}
        </div>
      )}
    </>
  );
}
