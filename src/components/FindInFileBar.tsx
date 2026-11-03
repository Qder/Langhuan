"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  describeFindHit,
  findInFileMatches,
  stepFindIndex,
} from "@/lib/findInFile";
import { matchShortcut, normalizeShortcuts } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function FindInFileBar() {
  const open = useStore((s) => s.findInFileOpen);
  const setOpen = useStore((s) => s.setFindInFileOpen);
  const getActive = useStore((s) => s.getActive);
  const getContent = useStore((s) => s.getContent);
  const activeId = useStore((s) => s.activeId);
  const drafts = useStore((s) => s.drafts);
  const documents = useStore((s) => s.documents);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const requestPreviewLocate = useStore((s) => s.requestPreviewLocate);
  const customShortcuts = useStore((s) => s.customShortcuts);
  const shortcuts = React.useMemo(
    () => normalizeShortcuts(customShortcuts),
    [customShortcuts]
  );

  const [query, setQuery] = React.useState("");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const content = React.useMemo(() => {
    if (!activeId) return "";
    return getContent(activeId);
    // drafts/documents keep content in sync while open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, drafts, documents, getContent]);

  const matches = React.useMemo(
    () =>
      query.trim()
        ? findInFileMatches(content, query, { caseSensitive, wholeWord })
        : [],
    [content, query, caseSensitive, wholeWord]
  );

  const safeIdx = matches.length
    ? Math.min(Math.max(0, idx), matches.length - 1)
    : -1;

  const jumpTo = React.useCallback(
    (nextIdx: number) => {
      if (!matches.length || nextIdx < 0) return;
      const hit = matches[nextIdx];
      if (!hit) return;
      setIdx(nextIdx);
      const { line, message } = describeFindHit(
        content,
        hit,
        nextIdx,
        matches.length
      );
      applyLocateResult(
        {
          start: hit.start,
          end: hit.end,
          precision: "exact",
          line,
          message,
        },
        // Keep the find input focused while highlighting the hit.
        { select: true, focus: false, highlight: true, center: true }
      );
      requestPreviewLocate(hit.start, { scroll: true, announce: false });
    },
    [matches, content, applyLocateResult, requestPreviewLocate]
  );

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => window.clearTimeout(t);
  }, [open, activeId]);

  React.useEffect(() => {
    setIdx(0);
  }, [query, caseSensitive, wholeWord, activeId]);

  React.useEffect(() => {
    if (!open) return;
    if (!query.trim() || !matches.length) return;
    jumpTo(0);
    // Auto-select first hit when the query or options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, caseSensitive, wholeWord, matches.length, activeId]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (matchShortcut(e, shortcuts.search)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, shortcuts.search]);

  if (!open) return null;

  const active = getActive();
  const countLabel = !query.trim()
    ? ""
    : matches.length
      ? `${safeIdx + 1}/${matches.length}`
      : "0/0";

  return (
    <div
      className="fixed top-3 right-3 z-[70] w-[min(100vw-1.5rem,22rem)] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl animate-enter"
      role="search"
      aria-label="文件内查找"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!matches.length) return;
              const next = stepFindIndex(
                safeIdx,
                matches.length,
                e.shiftKey ? -1 : 1
              );
              jumpTo(next);
            }
          }}
          placeholder={active ? "在当前文件中查找…" : "请先打开文档"}
          disabled={!active}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none font-ui"
          aria-label="查找内容"
        />
        <span className="text-[11px] tabular-nums text-[var(--muted)] w-12 text-right shrink-0">
          {countLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="上一个"
          disabled={!matches.length}
          onClick={() => jumpTo(stepFindIndex(safeIdx, matches.length, -1))}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="下一个"
          disabled={!matches.length}
          onClick={() => jumpTo(stepFindIndex(safeIdx, matches.length, 1))}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="关闭查找"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-[var(--muted)] font-ui">
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            className="rounded border-[var(--border)]"
          />
          区分大小写
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
            className="rounded border-[var(--border)]"
          />
          全词
        </label>
        <span className={cn("ml-auto", !active && "text-[var(--accent)]")}>
          {active ? "Enter 下一个 · Esc 关闭" : "无打开文档"}
        </span>
      </div>
    </div>
  );
}
