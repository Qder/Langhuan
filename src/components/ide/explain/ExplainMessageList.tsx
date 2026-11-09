"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../../ui/button";
import type { IdeExplainMessage } from "@/lib/ide/explain";
import { cn } from "@/lib/utils";
import { ExplainBody, ExplainFooterCitations } from "./markdown";
import { ExplainCaptureBar } from "./ExplainCaptureBar";
import type { ExplainCandidate, SendExplain } from "./types";
import type { IdeCitation } from "@/lib/ide/citations";
import type { ExplainFence } from "@/lib/ide/snippetLocate";
import { ExplainUsageHelp } from "./ExplainUsageHelp";
import {
  isNearExplainListBottom,
  nextExplainFollowPin,
  shouldFollowExplainScroll,
} from "@/lib/ide/explainScroll";
import { assistantBubbleKind } from "@/lib/ide/explainTimeout";

export function ExplainMessageList({
  hasSession,
  messages,
  busy,
  activePath,
  candidates,
  savedNotes,
  onSend,
  onCite,
  onFence,
  onCapture,
  onOpenSaved,
  onPickCandidate,
  jumpNotice,
  failedCitePath,
}: {
  hasSession: boolean;
  messages: IdeExplainMessage[];
  busy: boolean;
  activePath: string | null;
  candidates: ExplainCandidate[];
  savedNotes: Record<string, { docId: string; path: string }>;
  onSend: SendExplain;
  onCite: (c: IdeCitation) => void;
  onFence: (f: ExplainFence, msgId?: string) => void;
  onCapture: (msg: IdeExplainMessage) => void;
  onOpenSaved: (msgId: string) => void;
  onPickCandidate: (c: ExplainCandidate) => void;
  jumpNotice?: { path: string; message: string } | null;
  failedCitePath?: string | null;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const pinRef = React.useRef(true);
  const busyRef = React.useRef(busy);
  const lastContent =
    messages.length > 0 ? messages[messages.length - 1]?.content ?? "" : "";

  React.useEffect(() => {
    if (busy && !busyRef.current) {
      pinRef.current = nextExplainFollowPin(pinRef.current, { type: "turn-start" });
    } else if (!busy && busyRef.current) {
      const el = listRef.current;
      pinRef.current = nextExplainFollowPin(pinRef.current, {
        type: "turn-end",
        nearBottom: el ? isNearExplainListBottom(el) : true,
      });
    }
    busyRef.current = busy;
  }, [busy]);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el || !shouldFollowExplainScroll(pinRef.current)) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent, busy, candidates.length]);

  return (
    <div
      ref={listRef}
      className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3"
      onScroll={() => {
        const el = listRef.current;
        if (!el) return;
        pinRef.current = nextExplainFollowPin(pinRef.current, {
          type: "scroll",
          nearBottom: isNearExplainListBottom(el),
        });
      }}
      onPointerDown={() => {
        pinRef.current = nextExplainFollowPin(pinRef.current, {
          type: "pointerdown",
        });
      }}
    >
      {!hasSession ? (
        <div className="text-sm text-[var(--muted)] font-ui py-8 text-center">
          先打开文件夹，再问这个工程里的文件。
        </div>
      ) : messages.length === 0 ? (
        <div className="text-sm text-[var(--muted)] font-ui space-y-2 py-4">
          <ExplainUsageHelp />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {["这个文件在讲什么", "解释当前选区", "这个类和哪个文件有关"].map(
              (hint) => (
                <button
                  key={hint}
                  type="button"
                  className="px-2 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-xs"
                  onClick={() => void onSend(hint)}
                >
                  {hint}
                </button>
              )
            )}
          </div>
          {activePath && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void onSend("讲这个文件")}
            >
              讲这个文件
            </Button>
          )}
        </div>
      ) : (
        messages.map((m, i) => (
          <ExplainTurn
            key={m.id}
            msg={m}
            kind={assistantBubbleKind({
              content: m.content,
              busy,
              isLast: i === messages.length - 1,
            })}
            saved={savedNotes[m.id]}
            onCite={onCite}
            onFence={onFence}
            onCapture={onCapture}
            onOpenSaved={onOpenSaved}
            onRetry={() => {
              for (let j = i - 1; j >= 0; j -= 1) {
                const prev = messages[j];
                if (prev?.role === "user" && prev.content.trim()) {
                  void onSend(prev.content.trim());
                  return;
                }
              }
            }}
            failedCitePath={failedCitePath}
          />
        ))
      )}

      {(jumpNotice || candidates.length > 0) && (
        <div
          role="status"
          className="rounded-xl border border-dashed border-[var(--border)] px-2.5 py-2 text-xs font-ui"
        >
          <div className="text-[var(--muted)] mb-1">
            {jumpNotice?.message ?? "候选（点开）："}
          </div>
          {candidates.length > 0 ? (
            <div className="flex flex-col gap-1">
              {candidates.map((p, i) => (
                <button
                  key={`${p.path}:${p.line ?? ""}:${i}`}
                  type="button"
                  className="text-left text-[var(--accent)] hover:underline font-mono"
                  onClick={() => onPickCandidate(p)}
                >
                  {p.path}
                  {p.line != null
                    ? p.endLine != null && p.endLine !== p.line
                      ? `:${p.line}-${p.endLine}`
                      : `:${p.line}`
                    : ""}
                </button>
              ))}
            </div>
          ) : jumpNotice ? (
            <div className="text-[var(--muted)]">没有同名候选可点</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const ExplainTurn = React.memo(function ExplainTurn({
  msg,
  kind,
  saved,
  onCite,
  onFence,
  onCapture,
  onOpenSaved,
  onRetry,
  failedCitePath,
}: {
  msg: IdeExplainMessage;
  kind: ReturnType<typeof assistantBubbleKind>;
  saved?: { docId: string; path: string };
  onCite: (c: IdeCitation) => void;
  onFence: (f: ExplainFence, msgId?: string) => void;
  onCapture: (msg: IdeExplainMessage) => void;
  onOpenSaved: (msgId: string) => void;
  onRetry: () => void;
  failedCitePath?: string | null;
}) {
  const onFenceThis = React.useCallback(
    (f: ExplainFence) => onFence(f, msg.id),
    [onFence, msg.id]
  );
  return (
    <div
      className={cn(
        "rounded-xl px-2.5 py-2",
        msg.role === "user"
          ? "bg-[var(--hover)] ml-4"
          : "bg-[var(--card)] border border-[var(--border)] mr-2"
      )}
    >
      <div className="text-[10px] text-[var(--muted)] mb-1 font-ui">
        {msg.role === "user" ? "你" : msg.mock ? "示例讲解" : "讲解"}
      </div>
      {msg.role === "assistant" ? (
        kind === "generating" ? (
          <div className="flex items-center gap-1.5 text-[var(--muted)] text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            生成中…
          </div>
        ) : kind === "empty" ? (
          <div className="flex flex-wrap items-center gap-2 text-[var(--muted)] text-xs font-ui">
            <span>未生成内容</span>
            <button
              type="button"
              className="text-[var(--accent)] hover:underline"
              onClick={onRetry}
            >
              重试
            </button>
          </div>
        ) : (
          <>
            <ExplainBody
              content={msg.content}
              onCite={onCite}
              onFence={onFenceThis}
              failedCitePath={failedCitePath}
            />
            <ExplainFooterCitations
              content={msg.content}
              onCite={onCite}
              onFence={onFenceThis}
              failedCitePath={failedCitePath}
            />
            <ExplainCaptureBar
              msg={msg}
              savedDocId={saved?.docId}
              savedPath={saved?.path}
              onCapture={onCapture}
              onOpenSaved={onOpenSaved}
            />
          </>
        )
      ) : (
        <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
      )}
    </div>
  );
});
