"use client";

import { BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IdeExplainMessage } from "@/lib/ide/explain";

/** Per-answer「收入藏书阁」+ optional jump back to the saved note. */
export function ExplainCaptureBar({
  msg,
  savedDocId,
  savedPath,
  onCapture,
  onOpenSaved,
}: {
  msg: IdeExplainMessage;
  savedDocId?: string;
  savedPath?: string;
  onCapture: (msg: IdeExplainMessage) => void;
  onOpenSaved: (msgId: string) => void;
}) {
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-1.5 py-0.5",
            "max-lg:min-h-10 max-lg:px-2.5 text-[11px] font-ui text-[var(--muted)]",
            "hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          )}
          title="存进 读码笔记/<工程>/日期-文件.md；当天同一文件再次收入会追加一节"
          onClick={() => void onCapture(msg)}
        >
          <BookMarked className="h-3 w-3" />
          收入藏书阁
        </button>
        {savedDocId && (
          <button
            type="button"
            className="text-[11px] max-lg:min-h-10 font-ui text-[var(--accent)] hover:underline"
            onClick={() => onOpenSaved(msg.id)}
          >
            在藏书阁打开
          </button>
        )}
      </div>
      {savedPath ? (
        <p
          className="text-[11px] font-mono text-[var(--muted)] break-all leading-snug"
          title={savedPath}
        >
          {savedPath}
        </p>
      ) : null}
    </div>
  );
}

/** Composer row: dump the current editor selection into 速记.md. */
export function ExplainSnippetCapture({
  path,
  fromLine,
  toLine,
  onCapture,
}: {
  path: string;
  fromLine: number;
  toLine: number;
  onCapture: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full text-left text-[11px] font-ui text-[var(--muted)] hover:text-[var(--accent)] px-1 py-0.5"
      onClick={() => void onCapture()}
      title={`${path}:${fromLine}-${toLine}`}
    >
      <BookMarked className="mr-1 inline h-3 w-3" />
      从上次选区收入速记（{fromLine}-{toLine} 行，追加到 读码笔记/速记.md）
    </button>
  );
}
