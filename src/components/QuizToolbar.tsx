"use client";

import * as React from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuizCounts, QuizItem, QuizItemState } from "@/lib/quiz";

type Props = {
  counts: QuizCounts;
  activeItem: QuizItem | null;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onSetState: (itemId: string, state: QuizItemState) => void;
  className?: string;
};

export function QuizToolbar({
  counts,
  activeItem,
  onCollapseAll,
  onExpandAll,
  onSetState,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto z-30 flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] px-3 py-1.5 text-xs backdrop-blur-sm",
        className
      )}
      data-lh-quiz-toolbar="1"
    >
      <span className="text-[var(--muted)] tabular-nums shrink-0">
        共 {counts.total} 题 · 会 {counts.know} · 不会 {counts.dontKnow} · 未做{" "}
        {counts.unseen + counts.peeked}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 hover:bg-[var(--hover)]"
          onClick={onCollapseAll}
        >
          <ChevronsDownUp className="h-3.5 w-3.5" />
          收起全部答案
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 hover:bg-[var(--hover)]"
          onClick={onExpandAll}
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
          展开全部答案
        </button>
      </div>
      {activeItem && (
        <div className="ml-auto flex items-center gap-1">
          <span
            className="max-w-[10rem] truncate text-[var(--muted)]"
            title={activeItem.stem}
          >
            {activeItem.stem || "本题"}
          </span>
          <StateBtn
            label="会"
            active={activeItem.state === "know"}
            tone="know"
            onClick={() => onSetState(activeItem.id, "know")}
          />
          <StateBtn
            label="不会"
            active={activeItem.state === "dont_know"}
            tone="dont"
            onClick={() => onSetState(activeItem.id, "dont_know")}
          />
          <StateBtn
            label="看过答案"
            active={activeItem.state === "peeked"}
            tone="peek"
            onClick={() => onSetState(activeItem.id, "peeked")}
          />
        </div>
      )}
    </div>
  );
}

function StateBtn({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: "know" | "dont" | "peek";
  onClick: () => void;
}) {
  const activeCls =
    tone === "know"
      ? "border-[var(--teal)] bg-[color-mix(in_srgb,var(--teal)_18%,transparent)] text-[var(--teal)]"
      : tone === "dont"
        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"
        : "border-[var(--border)] bg-[var(--hover)]";
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2",
        active
          ? activeCls
          : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--hover)]"
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
