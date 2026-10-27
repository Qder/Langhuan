"use client";

import * as React from "react";
import { resolveWikiTarget } from "@/lib/search";
import { mdExcerpt, titleOf, cn } from "@/lib/utils";
import type { Document } from "@/lib/types";

type PeekState = {
  x: number;
  y: number;
  target: Document | null;
  label: string;
};

export function WikiLink({
  name,
  label,
  docs,
  onOpen,
}: {
  name: string;
  label: string;
  docs: Document[];
  onOpen: (id: string) => void;
}) {
  const target = resolveWikiTarget(docs, name);
  const [peek, setPeek] = React.useState<PeekState | null>(null);
  const showTimer = React.useRef<number | null>(null);
  const hideTimer = React.useRef<number | null>(null);
  const anchorRef = React.useRef<HTMLButtonElement>(null);

  const clearTimers = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };

  const scheduleShow = () => {
    clearTimers();
    showTimer.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPeek({
        x: Math.min(window.innerWidth - 320, Math.max(8, r.left)),
        y: Math.min(window.innerHeight - 160, r.bottom + 8),
        target: target ?? null,
        label,
      });
    }, 350);
  };

  const scheduleHide = () => {
    if (showTimer.current) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    hideTimer.current = window.setTimeout(() => setPeek(null), 180);
  };

  React.useEffect(() => {
    const onScroll = () => setPeek(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPeek(null);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      clearTimers();
    };
  }, []);

  const excerpt = target ? mdExcerpt(target.content, 160) : "";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cn("wiki-link", !target && "missing")}
        onClick={() => target && onOpen(target.id)}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
      >
        {label}
      </button>
      {peek && (
        <div
          className="lh-wiki-peek"
          style={{ left: peek.x, top: peek.y }}
          onMouseEnter={() => {
            if (hideTimer.current) {
              window.clearTimeout(hideTimer.current);
              hideTimer.current = null;
            }
          }}
          onMouseLeave={scheduleHide}
          role="tooltip"
        >
          {peek.target ? (
            <>
              <div className="lh-wiki-peek-title">{titleOf(peek.target.path)}</div>
              <div className="lh-wiki-peek-path">{peek.target.path}</div>
              {excerpt && <p className="lh-wiki-peek-excerpt">{excerpt}</p>}
              <button
                type="button"
                className="lh-wiki-peek-open"
                onClick={() => onOpen(peek.target!.id)}
              >
                打开
              </button>
            </>
          ) : (
            <>
              <div className="lh-wiki-peek-title">未找到</div>
              <div className="lh-wiki-peek-path">没有名为「{name}」的文档</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
