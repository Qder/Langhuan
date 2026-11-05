"use client";

import * as React from "react";
import { List, Minimize2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { TocPopover } from "./topbar/TocPopover";
import { useActiveHeading } from "./topbar/useActiveHeading";
import { useDocAsideData } from "./topbar/useDocAsideData";
import { onToggleTocRequest } from "@/lib/tocPanel";
import { useReadingProgressPercent } from "@/lib/useReadingProgress";

/** Floating strip while MD 专注 hides the top bar. */
export function MdFocusExitButton() {
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setStatus = useStore((s) => s.setStatus);
  const active = useStore((s) => s.getActive());
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const annotations = useStore((s) => s.annotations);
  const assetsForDoc = useStore((s) => s.assetsForDoc);

  const [tocOpen, setTocOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const progress = useReadingProgressPercent();

  const { outline, backlinks, asideAvailable } = useDocAsideData({
    active,
    documents,
    getContent,
    annotations,
    assetsForDoc,
  });
  const [activeHeading, setActiveHeading] = useActiveHeading({
    enabled: tocOpen,
    // No rail in 专注: the popover is the one and only outline surface.
    wide: false,
    docId: active?.id,
  });

  // Same dismissal contract as the TopBar popovers: outside click or Esc.
  React.useEffect(() => {
    if (!tocOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setTocOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTocOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tocOpen]);

  // mod+shift+o from AppShell: the panel owns its own open state, so it toggles
  // itself instead of AppShell reaching into a private useState.
  React.useEffect(() => onToggleTocRequest(() => setTocOpen((v) => !v)), []);

  // A 专注 toggle or doc switch leaves a stale panel floating over the wrong doc.
  React.useEffect(() => {
    setTocOpen(false);
  }, [active?.id]);

  const chip =
    "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-ui transition-colors hover:bg-[var(--hover)]";
  const bar =
    "pointer-events-auto fixed left-3 top-3 z-[60] flex items-center gap-0.5 overflow-hidden rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] px-1.5 py-1 text-[var(--fg)] shadow-lg backdrop-blur-md max-lg:left-[max(0.75rem,env(safe-area-inset-left))] max-lg:top-[max(0.75rem,env(safe-area-inset-top))]";

  return (
    <>
      <div className={bar}>
        <button
          ref={buttonRef}
          type="button"
          className={cn(chip, tocOpen && "bg-[var(--hover)]")}
          onClick={() => {
            if (!asideAvailable) {
              setStatus("这篇还没有大纲，加几个标题就能跳转");
              return;
            }
            setTocOpen((v) => !v);
          }}
          aria-label="目录"
          aria-expanded={tocOpen}
          title="目录 (Ctrl/⌘ Shift O)"
        >
          <List className="h-3.5 w-3.5" />
          目录
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
        <button
          type="button"
          className={chip}
          onClick={() => {
            setTocOpen(false);
            setMdFocusMode(false);
            setStatus("已退出专注模式");
          }}
          aria-label="退出专注"
          title="退出专注模式 (Esc)"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          退出
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
        <span
          className="px-1.5 text-[11px] font-ui tabular-nums text-[var(--muted)]"
          aria-label="阅读进度"
          title="阅读进度"
        >
          {Math.round(progress)}%
        </span>
        {/* 1px 底衬进度：和顶栏那条 2px 同源，专注时也有「读到哪」的把握。 */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 bottom-0 h-px overflow-hidden rounded-full bg-[var(--border)]"
        >
          <span
            className="block h-full bg-[var(--accent)] transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </span>
      </div>
      {active && tocOpen && (
        <TocPopover
          open={tocOpen}
          panelRef={panelRef}
          doc={active}
          outline={outline}
          backlinks={backlinks}
          activeHeading={activeHeading}
          onNavigateHeading={(id) => {
            setActiveHeading(id);
            // Same contract as the TopBar 目录: a jump dismisses the panel so the
            // reader sees the heading it just asked for.
            setTocOpen(false);
          }}
          anchor="floating"
        />
      )}
    </>
  );
}

