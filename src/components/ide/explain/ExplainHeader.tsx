"use client";

import * as React from "react";
import { Eraser, History, Plus, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { useIdeStore } from "@/lib/ide/store";
import {
  listExplainThreadsNewestFirst,
  type IdeExplainThread,
} from "@/lib/ide/explainThreads";

const EMPTY_THREADS: IdeExplainThread[] = [];

export function ExplainHeader({
  isMock,
  onToggleSettings,
  onStop,
  onClose,
}: {
  isMock: boolean;
  onToggleSettings: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const threads = useIdeStore((s) => {
    const id = s.session?.id;
    if (!id) return EMPTY_THREADS;
    return s.explainThreadsBySession[id] ?? EMPTY_THREADS;
  });
  const activeThreadId = useIdeStore((s) => {
    const id = s.session?.id;
    return id ? s.explainActiveThreadIdBySession[id] : undefined;
  });
  const startExplainThread = useIdeStore((s) => s.startExplainThread);
  const switchExplainThread = useIdeStore((s) => s.switchExplainThread);
  const clearExplainHistory = useIdeStore((s) => s.clearExplainHistory);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const listed = listExplainThreadsNewestFirst(threads);
  const active = listed.find((t) => t.id === activeThreadId);
  return (
    <div className="shrink-0 border-b border-[var(--chrome-border)]">
      <div className="h-11 flex items-center gap-1 px-2">
        <Sparkles className="h-4 w-4 text-[var(--accent)] ml-1" />
        <div className="flex-1 min-w-0 font-ui text-sm font-medium truncate">
          讲解
          {active?.title && active.title !== "新对话" ? (
            <span className="ml-1.5 font-normal text-[var(--muted)]">
              · {active.title}
            </span>
          ) : null}
        </div>
        {isMock && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">
            未配置 API，这是本地示例讲解
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[11px] font-ui"
          aria-label="历史"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <History className="h-3.5 w-3.5" />
          历史
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[11px] font-ui"
          aria-label="新对话"
          onClick={() => {
            onStop();
            startExplainThread();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          新对话
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="设置"
          onClick={onToggleSettings}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="清空当前对话"
          title="清空当前对话"
          onClick={() => {
            onStop();
            clearExplainHistory();
          }}
        >
          <Eraser className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="关闭讲解" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {historyOpen ? (
        <div
          className="max-h-40 overflow-y-auto px-2 pb-2 space-y-1"
          role="listbox"
          aria-label="讲解历史"
        >
          {listed.length === 0 ? (
            <p className="px-1 py-1 text-[11px] font-ui text-[var(--muted)]">
              还没有对话。发一条，或点「新对话」。
            </p>
          ) : (
            listed.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === activeThreadId}
                className={cn(
                  "w-full text-left rounded-lg px-2 py-1.5 text-[12px] font-ui",
                  t.id === activeThreadId
                    ? "bg-[var(--hover)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
                )}
                onClick={() => {
                  onStop();
                  switchExplainThread(t.id);
                }}
              >
                <div className="truncate">{t.title || "新对话"}</div>
                <div className="text-[10px] opacity-80">
                  {t.messages.length ? `${t.messages.length} 条` : "空对话"}
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
