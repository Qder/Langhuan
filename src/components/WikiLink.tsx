"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveWikiTarget } from "@/lib/search";
import { planWikiCreatePath } from "@/lib/wikilink";
import { mdExcerpt, titleOf, cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useIdeStore } from "@/lib/ide/store";
import {
  ideLinkLabel,
  isIdeLinkTarget,
  parseIdeLinkTarget,
} from "@/lib/ide/ideLink";

type PeekState = {
  x: number;
  y: number;
  targetId: string | null;
  targetPath: string | null;
  excerpt: string;
  label: string;
};

export function WikiLink({
  name,
  label,
  heading,
  onOpen,
  currentPath,
}: {
  name: string;
  label: string;
  heading?: string;
  /** Optional; defaults to store.requestOpenDoc via getState (keeps MarkdownBody deps free). */
  onOpen?: (id: string) => void;
  /** Path of the document that contains this link (same-folder create). */
  currentPath?: string;
}) {
  // `[[ide:src/foo.ts:12]]` — deep link into 读码, never a library document.
  const ideTarget = React.useMemo(
    () => (isIdeLinkTarget(name) ? parseIdeLinkTarget(name) : null),
    [name]
  );
  // useShallow: only re-render when resolved id/path/content change.
  const target = useStore(
    useShallow((s) => {
      const d = resolveWikiTarget(s.documents, name);
      if (!d) return { id: null as string | null, path: null as string | null, content: null as string | null };
      return { id: d.id, path: d.path, content: d.content };
    })
  );
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const [peek, setPeek] = React.useState<PeekState | null>(null);
  const showTimer = React.useRef<number | null>(null);
  const hideTimer = React.useRef<number | null>(null);
  const anchorRef = React.useRef<HTMLButtonElement>(null);

  const openTarget = React.useCallback(
    (id: string) => {
      if (onOpen) onOpen(id);
      else useStore.getState().requestOpenDoc(id);
    },
    [onOpen]
  );

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
        targetId: target.id,
        targetPath: target.path,
        excerpt: target.content ? mdExcerpt(target.content, 160) : "",
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

  const tryCreateMissing = () => {
    const basePath = currentPath || "";
    const plan = planWikiCreatePath(basePath, name);
    if (!plan.ok) {
      setStatus(plan.reason);
      return;
    }
    const ok = window.confirm(`创建 ${plan.fileName}？`);
    if (!ok) return;
    createDoc({ type: "md", path: plan.path, open: true });
  };

  if (isIdeLinkTarget(name)) {
    if (!ideTarget) {
      return (
        <span
          className="wiki-link missing"
          title={`无效的读码链接：${name}`}
        >
          {label || name}
        </span>
      );
    }
    const openIde = () => {
      useStore.getState().setAppMode("ide");
      useIdeStore.getState().followIdeLink(ideTarget);
    };
    return (
      <button
        type="button"
        className="wiki-link ide-link"
        title={`在读码打开 ${ideLinkLabel(ideTarget, 200)}`}
        onClick={openIde}
      >
        {ideLinkLabel(ideTarget)}
      </button>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cn("wiki-link", !target.id && "missing")}
        onClick={() => {
          if (!target.id) {
            tryCreateMissing();
            return;
          }
          openTarget(target.id);
          if (heading) {
            window.setTimeout(() => {
              const id = heading
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^\w\u4e00-\u9fff-]/g, "");
              const el = document.getElementById(heading) || document.getElementById(id);
              el?.scrollIntoView({ behavior: "smooth" });
            }, 200);
          }
        }}
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
          {peek.targetId ? (
            <>
              <div className="lh-wiki-peek-title">
                {peek.targetPath ? titleOf(peek.targetPath) : peek.label}
              </div>
              <div className="lh-wiki-peek-path">{peek.targetPath}</div>
              {peek.excerpt && <p className="lh-wiki-peek-excerpt">{peek.excerpt}</p>}
              <button
                type="button"
                className="lh-wiki-peek-open"
                onClick={() => openTarget(peek.targetId!)}
              >
                打开
              </button>
            </>
          ) : (
            <>
              <div className="lh-wiki-peek-title">未找到</div>
              <div className="lh-wiki-peek-path">没有名为「{name}」的文档</div>
              <button
                type="button"
                className="lh-wiki-peek-open"
                onClick={() => {
                  setPeek(null);
                  tryCreateMissing();
                }}
              >
                创建笔记
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
