"use client";

import { Send, Square } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { ExplainSnippetCapture } from "./ExplainCaptureBar";
import { shouldSendOnExplainComposerKey } from "./composerKeys";
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
    <div
      className={cn(
        "shrink-0 p-2 space-y-1.5",
        // 消息列表底边：浅色主题 --chrome-border 太淡，加粗顶边 + 一点上阴影 + 底色差
        "border-t-2 border-[color-mix(in_srgb,var(--fg)_28%,var(--chrome-border))]",
        "bg-[color-mix(in_srgb,var(--fg)_5%,var(--chrome))]",
        "shadow-[0_-8px_16px_-10px_color-mix(in_srgb,var(--fg)_35%,transparent)]"
      )}
    >
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
        <label
          className={cn(
            "inline-flex items-center gap-1.5",
            !selectionActive && "opacity-60 cursor-not-allowed"
          )}
          title={!selectionActive ? "先在编辑器划词" : undefined}
        >
          <input
            type="checkbox"
            checked={includeSelection && selectionActive}
            onChange={(e) => onIncludeSelection(e.target.checked)}
            disabled={!selectionActive}
            aria-describedby={!selectionActive ? "explain-sel-hint" : undefined}
          />
          当前选区
          {!selectionActive ? (
            <span id="explain-sel-hint" className="text-[10px] text-[var(--muted)]">
              （先在编辑器划词）
            </span>
          ) : null}
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
          placeholder={
            hasSession ? "问这个文件 / 选区…（Enter 发送 · Shift+Enter 换行）" : "先打开文件夹"
          }
          value={question}
          disabled={!hasSession || busy}
          onChange={(e) => onQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (!shouldSendOnExplainComposerKey(e)) return;
            e.preventDefault();
            if (busy || !question.trim()) return;
            void onSend();
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
      {hasSession && !emptyHistory ? (
        <p className="px-1 text-[11px] font-ui text-[var(--muted)]">
          追问会带上当前对话；「新对话」或「清空当前对话」才是全新提问
        </p>
      ) : null}
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
