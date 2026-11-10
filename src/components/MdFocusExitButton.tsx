"use client";

import * as React from "react";
import { List, Minimize2, Type } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ReadingStatsCard, useReadingStats } from "./ReadingStatsCard";
import { readingStatsTitle } from "@/lib/readingStats";
import { TocPopover } from "./topbar/TocPopover";
import { useActiveHeading } from "./topbar/useActiveHeading";
import { useDocAsideData } from "./topbar/useDocAsideData";
import { useTocPanel } from "@/lib/tocPanel";
import { useReadingProgressPercent } from "@/lib/useReadingProgress";
import { ImmersiveClockBattery } from "./ImmersiveClockBattery";

/** Floating strip while MD 专注 hides the top bar. */
export function MdFocusExitButton() {
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setStatus = useStore((s) => s.setStatus);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const setReadingPrefs = useStore((s) => s.setReadingPrefs);
  const viewMode = useStore((s) => s.viewMode);
  const active = useStore((s) => s.getActive());
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const annotations = useStore((s) => s.annotations);
  const assetsForDoc = useStore((s) => s.assetsForDoc);

  const progress = useReadingProgressPercent();
  const focusContent = active ? getContent(active.id) : "";
  const stats = useReadingStats(focusContent, active?.type === "html" ? "html" : "md");

  const { outline, backlinks, asideAvailable } = useDocAsideData({
    active,
    documents,
    getContent,
    annotations,
    assetsForDoc,
  });
  const toc = useTocPanel({ docId: active?.id, available: asideAvailable });
  const {
    open: tocOpen,
    setOpen: setTocOpen,
    buttonRef,
    panelRef,
  } = toc;
  const [activeHeading, setActiveHeading] = useActiveHeading({
    enabled: tocOpen,
    // No rail in 专注: the popover is the one and only outline surface.
    wide: false,
    docId: active?.id,
  });

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
            setTocOpen(!tocOpen);
          }}
          aria-label="目录"
          aria-expanded={tocOpen}
          title="目录 (Ctrl/⌘ Shift O)"
        >
          <List className="h-3.5 w-3.5" />
          目录
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
        {/* 专注时顶栏整块不渲染，阅读弹层也跟着消失——打字机开关必须在这里留一个，
            否则「专注下仍生效」只能靠记快捷键，等于不可发现。
            只在源码/混合模式展示：纯预览没有可跟随的编辑光标。 */}
        {active?.type === "md" && viewMode !== "preview" && (
          <>
            <button
              type="button"
              className={cn(chip, readingPrefs.typewriterMode && "text-[var(--accent)]")}
              onClick={() => {
                const next = !readingPrefs.typewriterMode;
                setReadingPrefs({ typewriterMode: next });
                setStatus(next ? "打字机滚动：开" : "打字机滚动：关");
              }}
              aria-pressed={readingPrefs.typewriterMode}
              aria-label="打字机滚动"
              title="打字机滚动 (Ctrl/⌘ Shift T)"
            >
              <Type className="h-3.5 w-3.5" />
              打字机
            </button>
            <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
          </>
        )}
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
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
        {/* 专注时顶栏整块不渲染，浮动条是唯一能看到字数与时长的地方，
            所以窄屏也不收起，只把字号压到 10px。 */}
        <span
          className="px-1.5"
          data-focus-stats=""
          title={readingStatsTitle(stats)}
        >
          <ReadingStatsCard stats={stats} compact className="max-lg:text-[10px]" />
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
      <ImmersiveClockBattery variant="focus" />
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

