"use client";

import * as React from "react";
import { Tag } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/**
 * HTML 文档标签 popover (wide screens only — the header has no room below lg).
 * Local input state stays here: it is transient UI, not document state, so the
 * orchestrator never needs to know about it.
 */
export function TagsPopover({
  open,
  onToggle,
  buttonRef,
  panelRef,
  tags,
  onSetTags,
  input,
  onInputChange,
}: {
  open: boolean;
  onToggle: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  tags: string[];
  onSetTags: (tags: string[]) => void;
  /** Draft text is owned by the parent so closing the popover keeps it. */
  input: string;
  onInputChange: (value: string) => void;
}) {
  return (
    <div className="relative hidden lg:block">
      <Button
        ref={buttonRef}
        variant={open ? "secondary" : "ghost"}
        size="sm"
        aria-label="标签"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Tag className="h-3.5 w-3.5" />
        标签 ({tags.length})
      </Button>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl animate-enter"
        >
          <div className="mb-2 text-xs text-[var(--muted)] font-ui">文档标签</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.length === 0 && (
              <span className="text-xs text-[var(--muted)]">暂无标签</span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
              >
                {t}
                <button
                  type="button"
                  aria-label={`删除标签 ${t}`}
                  className="hover:text-[var(--accent)]"
                  onClick={() => onSetTags(tags.filter((x) => x !== t))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = input.trim();
              if (!next || tags.includes(next)) return;
              onSetTags([...tags, next]);
              onInputChange("");
            }}
            className="flex gap-1.5"
          >
            <Input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="+ 标签"
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" variant="outline">
              添加
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
