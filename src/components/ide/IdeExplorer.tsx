"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import { useIdeStore } from "@/lib/ide/store";
import type { IdeFsEntry } from "@/lib/ide/ideFs";
import {
  childrenLookupFromMap,
  compactFolderChain,
} from "@/lib/ide/compactFolders";
import { cn } from "@/lib/utils";
import {
  EXPLORER_REVEAL_HIGHLIGHT_MS,
  explorerRevealStillWaiting,
  explorerRowSelector,
} from "@/lib/ide/explorerReveal";

/** Stable empty list for zustand selectors (avoid `|| []` new ref → getSnapshot loop). */
const EMPTY_ENTRIES: IdeFsEntry[] = [];

const ExplorerFlashContext = React.createContext<string | null>(null);

function TreeRow({
  entry,
  depth,
}: {
  entry: IdeFsEntry;
  depth: number;
}) {
  const childrenMap = useIdeStore((s) => s.children);
  const activePath = useIdeStore((s) => s.activePath);
  const toggleExpanded = useIdeStore((s) => s.toggleExpanded);
  const openFile = useIdeStore((s) => s.openFile);
  const ensureDirListed = useIdeStore((s) => s.ensureDirListed);
  const flashPath = React.useContext(ExplorerFlashContext);

  const chain = React.useMemo(() => {
    if (entry.kind !== "directory") return null;
    return compactFolderChain(entry, childrenLookupFromMap(childrenMap));
  }, [entry, childrenMap]);

  const leafPath = chain?.leafPath ?? entry.path;
  const expanded = useIdeStore((s) => !!s.expanded[leafPath]);
  const leafChildren = useIdeStore((s) => s.children[leafPath]);

  React.useEffect(() => {
    if (entry.kind !== "directory") return;
    if (chain?.needsList) {
      void ensureDirListed(chain.needsList);
      return;
    }
    if (expanded && !leafChildren) {
      void ensureDirListed(leafPath);
    }
  }, [
    entry.kind,
    chain?.needsList,
    expanded,
    leafChildren,
    leafPath,
    ensureDirListed,
  ]);

  if (entry.kind === "directory" && chain) {
    const label = chain.label;
    return (
      <div>
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-1 h-8 px-1 text-left text-[13px] font-ui hover:bg-[var(--hover)] rounded-md",
            "text-[var(--fg)]"
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggleExpanded(leafPath)}
          title={leafPath}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          )}
          <span className="truncate">{label}</span>
        </button>
        {expanded && leafChildren && (
          <div>
            {leafChildren.map((c) => (
              <TreeRow key={c.path} entry={c} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = activePath === entry.path;
  const flashing = flashPath === entry.path;
  return (
    <button
      type="button"
      data-ide-path={entry.path}
      className={cn(
        "w-full flex items-center gap-1.5 h-8 px-1 text-left text-[13px] font-ui rounded-md",
        active
          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
          : "text-[var(--fg)] hover:bg-[var(--hover)]",
        flashing && "lh-ide-explorer-flash"
      )}
      style={{ paddingLeft: 8 + depth * 12 + 16 }}
      onClick={() => void openFile(entry.path)}
      title={entry.path}
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function IdeExplorer() {
  const session = useIdeStore((s) => s.session);
  const rootChildren = useIdeStore((s) => s.children[""] ?? EMPTY_ENTRIES);
  const ensureDirListed = useIdeStore((s) => s.ensureDirListed);
  const loadingTree = useIdeStore((s) => s.loadingTree);
  const pendingExplorerReveal = useIdeStore((s) => s.pendingExplorerReveal);
  const clearPendingExplorerReveal = useIdeStore(
    (s) => s.clearPendingExplorerReveal
  );
  const [flashPath, setFlashPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (session) void ensureDirListed("");
  }, [session, ensureDirListed]);

  React.useEffect(() => {
    if (!pendingExplorerReveal) return;
    const { path } = pendingExplorerReveal;
    const started = Date.now();
    let cancelled = false;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const finishHighlight = () => {
      setFlashPath(path);
      highlightTimer = setTimeout(() => {
        setFlashPath((cur) => (cur === path ? null : cur));
      }, EXPLORER_REVEAL_HIGHLIGHT_MS);
    };

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector(explorerRowSelector(path));
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "nearest" });
        finishHighlight();
        clearPendingExplorerReveal();
        return;
      }
      const now = Date.now();
      if (!explorerRevealStillWaiting(started, now, false)) {
        // Give up scroll; file open already succeeded in store.openFile.
        clearPendingExplorerReveal();
        return;
      }
      pollTimer = setTimeout(tryScroll, 50);
    };

    pollTimer = setTimeout(tryScroll, 0);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  }, [
    pendingExplorerReveal?.path,
    pendingExplorerReveal?.nonce,
    clearPendingExplorerReveal,
  ]);

  if (!session) return null;

  return (
    <aside
      className="w-[260px] shrink-0 flex flex-col border-r border-[var(--chrome-border)] bg-[var(--chrome)] lg:shadow-[var(--chrome-shadow)]"
      aria-label="资源管理器"
    >
      <div className="h-10 px-3 flex items-center text-xs font-ui uppercase tracking-wide text-[var(--muted)] border-b border-[var(--chrome-border)] shrink-0">
        资源管理器
      </div>
      <div className="px-2 py-1.5 text-xs font-serif font-semibold truncate border-b border-[var(--chrome-border)]/60 shrink-0" title={session.pathLabel}>
        {session.name}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1 px-1">
        <ExplorerFlashContext.Provider value={flashPath}>
          {loadingTree && rootChildren.length === 0 && (
            <div className="px-2 py-3 text-xs text-[var(--muted)]">读取中…</div>
          )}
          {rootChildren.map((e) => (
            <TreeRow key={e.path} entry={e} depth={0} />
          ))}
          {!loadingTree && rootChildren.length === 0 && (
            <div className="px-2 py-3 text-xs text-[var(--muted)]">空目录或均被忽略</div>
          )}
        </ExplorerFlashContext.Provider>
      </div>
    </aside>
  );
}
