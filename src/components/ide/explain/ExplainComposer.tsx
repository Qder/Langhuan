"use client";

import { Send, Square } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { ExplainSnippetCapture } from "./ExplainCaptureBar";
import type { SendExplain } from "./types";

/** B5 — three chips; each fires an explain request with the current context. */
const EXPLAIN_PRESETS = [
  "这个文件在干什么",
  "它依赖谁、谁依赖它",
  "从哪读起",
] as const;

export function ExplainComposer({
  hasSession,
  emptyHistory,
  busy,
  question,
  includeFile,
  includeSelection,
  includeNearby,
  selectionActive,
  selectionRange,
  onQuestion,
  onIncludeFile,
  onIncludeSelection,
  onIncludeNearby,
  onSend,
  onStop,
  onCaptureSelection,
}: {
  hasSession: boolean;
  emptyHistory: boolean;
  busy: boolean;
  question: string;
  includeFile: boolean;
  includeSelection: boolean;
  includeNearby: boolean;
  selectionActive: boolean;
  selectionRange: { path: string; fromLine: number; toLine: number } | null;
  onQuestion: (v: string) => void;
  onIncludeFile: (v: boolean) => void;
  onIncludeSelection: (v: boolean) => void;
  onIncludeNearby: (v: boolean) => void;
  onSend: SendExplain;
  onStop: () => void;
  onCaptureSelection: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--chrome-border)] p-2 space-y-1.5">
      {hasSession && emptyHistory && !busy && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {EXPLAIN_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="px-2 py-1 max-lg:min-h-9 rounded-lg border border-[var(--border)] text-[11px] font-ui text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              onClick={() => void onSend(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-[11px] font-ui text-[var(--muted)] px-1">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeFile}
            onChange={(e) => onIncludeFile(e.target.checked)}
          />
          带上当前文件
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeSelection}
            onChange={(e) => onIncludeSelection(e.target.checked)}
            disabled={!selectionActive}
          />
          当前选区
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeNearby}
            onChange={(e) => onIncludeNearby(e.target.checked)}
          />
          带上相关文件
        </label>
      </div>
      <div className="flex gap-1.5 items-end">
        <textarea
          className={cn(
            "flex-1 min-h-[64px] max-h-32 rounded-xl border border-[var(--border)] bg-[var(--card)]",
            "px-2.5 py-2 text-sm font-ui resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
          )}
          placeholder={hasSession ? "问这个文件 / 选区…" : "先打开文件夹"}
          value={question}
          disabled={!hasSession || busy}
          onChange={(e) => onQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        {busy ? (
          <Button variant="outline" size="icon" aria-label="停止" onClick={onStop}>
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="accent"
            size="icon"
            aria-label="发送"
            disabled={!hasSession || !question.trim()}
            onClick={() => void onSend()}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      {selectionRange && (
        <ExplainSnippetCapture
          path={selectionRange.path}
          fromLine={selectionRange.fromLine}
          toLine={selectionRange.toLine}
          onCapture={onCaptureSelection}
        />
      )}
    </div>
  );
}
