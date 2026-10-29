"use client";

import * as React from "react";
import { BookOpenCheck, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  buildQuizReviewList,
  parseQuizItemId,
  reviewBadgeCount,
  type QuizReviewEntry,
} from "@/lib/quiz";
import { titleOf, cn } from "@/lib/utils";

export function QuizReviewDialog() {
  const open = useStore((s) => s.quizReviewOpen);
  const setOpen = useStore((s) => s.setQuizReviewOpen);
  const quizDocs = useStore((s) => s.quizDocs);
  const documents = useStore((s) => s.documents);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const setViewMode = useStore((s) => s.setViewMode);
  const requestPreviewLocate = useStore((s) => s.requestPreviewLocate);
  const setPendingQuizReveal = useStore((s) => s.setPendingQuizReveal);
  const setStatus = useStore((s) => s.setStatus);
  const [showUnseen, setShowUnseen] = React.useState(false);

  const liveIds = React.useMemo(
    () => new Set(documents.map((d) => d.id)),
    [documents]
  );
  const pathById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of documents) m.set(d.id, d.path);
    return m;
  }, [documents]);

  const dontKnow = React.useMemo(
    () =>
      buildQuizReviewList(quizDocs, liveIds, { includeUnseen: false }).filter(
        (e) => e.item.state === "dont_know"
      ),
    [quizDocs, liveIds]
  );
  const unseen = React.useMemo(
    () =>
      buildQuizReviewList(quizDocs, liveIds, { includeUnseen: true }).filter(
        (e) => e.item.state === "unseen"
      ),
    [quizDocs, liveIds]
  );
  const badge = reviewBadgeCount(quizDocs, liveIds);

  const jump = (entry: QuizReviewEntry) => {
    const range = parseQuizItemId(entry.item.id);
    setPendingQuizReveal({ docId: entry.docId, itemId: entry.item.id });
    openDoc(entry.docId);
    setViewMode("preview");
    if (range) {
      // Slight delay so iframe can mount; HtmlReader also consumes pendingQuizReveal.
      window.setTimeout(() => {
        requestPreviewLocate(range.start, { scroll: true, announce: true });
      }, 80);
    }
    setStatus(`已打开待复习：${entry.item.stem || entry.item.id}`);
    setOpen(false);
  };

  const groupByDoc = (entries: QuizReviewEntry[]) => {
    const map = new Map<string, QuizReviewEntry[]>();
    for (const e of entries) {
      const list = map.get(e.docId) || [];
      list.push(e);
      map.set(e.docId, list);
    }
    return [...map.entries()];
  };

  const empty = dontKnow.length === 0 && (!showUnseen || unseen.length === 0);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      labelledBy="quiz-review-title"
      className="max-w-xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <BookOpenCheck className="h-4 w-4 text-[var(--accent)]" />
        <h2 id="quiz-review-title" className="text-sm font-medium flex-1">
          待复习
        </h2>
        <span className="text-[11px] text-[var(--muted)] tabular-nums">
          不会 {badge.dontKnow} · 未做 {badge.unseen}
        </span>
        <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(false)}>
          关闭
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-auto px-2 py-2">
        {dontKnow.length === 0 && unseen.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
            没有待复习的题目
          </p>
        ) : (
          <>
            {dontKnow.length > 0 && (
              <Section
                title="不会"
                groups={groupByDoc(dontKnow)}
                pathById={pathById}
                onJump={jump}
              />
            )}
            {unseen.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
                  onClick={() => setShowUnseen((v) => !v)}
                >
                  {showUnseen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  未做（{unseen.length}）
                </button>
                {showUnseen && (
                  <Section
                    title=""
                    groups={groupByDoc(unseen)}
                    pathById={pathById}
                    onJump={jump}
                  />
                )}
              </div>
            )}
            {empty && dontKnow.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                没有标记为「不会」的题目
                {unseen.length > 0 ? "（可展开未做）" : ""}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Section({
  title,
  groups,
  pathById,
  onJump,
}: {
  title: string;
  groups: Array<[string, QuizReviewEntry[]]>;
  pathById: Map<string, string>;
  onJump: (e: QuizReviewEntry) => void;
}) {
  return (
    <div className="space-y-2">
      {title ? (
        <div className="px-3 pt-1 text-[11px] uppercase tracking-wider text-[var(--muted)]">
          {title}
        </div>
      ) : null}
      {groups.map(([docId, items]) => {
        const path = pathById.get(docId) || docId;
        return (
          <div key={docId} className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--hover)] px-3 py-1.5 text-xs font-medium truncate">
              {titleOf(path)}
              <span className="ml-2 text-[var(--muted)] font-normal">{path}</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {items.map((e) => (
                <li key={e.item.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
                    )}
                    onClick={() => onJump(e)}
                  >
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        e.item.state === "dont_know"
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--muted)]"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {e.item.stem || e.item.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
