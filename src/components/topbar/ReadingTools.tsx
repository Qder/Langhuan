"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  ExternalLink,
  Link2,
  ListTree,
  Maximize2,
  PanelRight,
  PanelRightClose,
  ScanSearch,
  Star,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

/**
 * Desktop-only (lg+) reading tools that sit right after the view segment.
 *
 * Kept separate from the 阅读 popover because these are the actions worth a
 * permanent pixel budget when there is room: 字号 stepper, 专注, HTML quick
 * actions, and the split-pane orientation / sync toggles.
 */
export function ReadingTools({
  isHtml,
  viewMode,
  hasHtmlPrefs,
  readingFontSize,
  onCycleFontSize,
  mdFocusMode,
  setMdFocusMode,
  onOpenHtmlInNewTab,
  htmlInspectEnabled,
  onToggleHtmlInspect,
  setHtmlImmersive,
  tabletUp,
  splitSourceFirst,
  toggleSplitSourceFirst,
  syncScrollOn,
  onToggleSyncScroll,
}: {
  isHtml: boolean;
  viewMode: string;
  hasHtmlPrefs: boolean;
  readingFontSize: number;
  onCycleFontSize: () => void;
  mdFocusMode: boolean;
  setMdFocusMode: (on: boolean) => void;
  onOpenHtmlInNewTab: () => void;
  htmlInspectEnabled: boolean;
  onToggleHtmlInspect: () => void;
  setHtmlImmersive: (on: boolean) => void;
  tabletUp: boolean;
  splitSourceFirst: boolean;
  toggleSplitSourceFirst: () => void;
  syncScrollOn: boolean;
  onToggleSyncScroll: () => void;
}) {
  return (
    <>
      {/* Wide: MD reading tools — single 字号 stepper + 专注; the rest live in 阅读 */}
      {!isHtml && viewMode !== "source" && (
        <div className="hidden lg:flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="切换正文字号"
            title="字号：点击切换 15 / 17 / 19 / 21px（完整设置在「阅读」）"
            onClick={onCycleFontSize}
          >
            <span className="text-[11px] tabular-nums">字 {readingFontSize}</span>
          </Button>
          <Button
            variant={mdFocusMode ? "secondary" : "ghost"}
            size="sm"
            aria-label="专注模式"
            title="专注模式 (F)"
            onClick={() => setMdFocusMode(!mdFocusMode)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            专注
          </Button>
        </div>
      )}

      {/* HTML quick tools stay on wide; everything else in 阅读 */}
      {isHtml && viewMode !== "source" && hasHtmlPrefs && (
        <div className="hidden lg:flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="在新标签页打开"
            title="在新标签页打开"
            onClick={onOpenHtmlInNewTab}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant={htmlInspectEnabled ? "secondary" : "ghost"}
            size="sm"
            aria-label={htmlInspectEnabled ? "关闭元素检视" : "开启元素检视"}
            aria-pressed={htmlInspectEnabled}
            title={
              htmlInspectEnabled
                ? "检视已开：点击元素查看 HTML / 样式 / 行为"
                : "默认只阅读文档。开启后点击即检视；也可以按住 Alt 点一下"
            }
            onClick={onToggleHtmlInspect}
          >
            <ScanSearch className="h-3.5 w-3.5" />
            检视
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="沉浸模式"
            title="沉浸模式 (F)"
            onClick={() => setHtmlImmersive(true)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            沉浸
          </Button>
        </div>
      )}

      {/* Wide: split extras (kept inline only on desktop) */}
      {viewMode === "split" && tabletUp && (
        <div className="hidden lg:flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleSplitSourceFirst()}
            title={splitSourceFirst ? "切换为预览在左" : "切换为源码在左"}
            aria-label={
              splitSourceFirst
                ? "当前源码在左，点击改为预览在左"
                : "当前预览在左，点击改为源码在左"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)]",
              "bg-[var(--card)] px-2.5 py-1 text-xs font-ui transition-colors",
              "hover:bg-[var(--hover)] hover:border-[var(--accent)]/40"
            )}
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--muted)]" />
            <span>{splitSourceFirst ? "源码在左" : "预览在左"}</span>
          </button>
          <button
            type="button"
            onClick={onToggleSyncScroll}
            title={syncScrollOn ? "关闭同步滚动（点击定位仍可用）" : "开启同步滚动"}
            aria-label={syncScrollOn ? "同步滚动已开启" : "同步滚动已关闭"}
            aria-pressed={syncScrollOn}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)]",
              "bg-[var(--card)] px-2.5 py-1 text-xs font-ui transition-colors",
              "hover:bg-[var(--hover)] hover:border-[var(--accent)]/40",
              syncScrollOn && "border-[var(--accent)]/50 text-[var(--accent)]"
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{syncScrollOn ? "同步滚动" : "同步已关"}</span>
          </button>
        </div>
      )}
    </>
  );
}

/** 目录 / rail toggle / star — the wide-only document cluster. */
export function DocActions({
  showTocButton,
  tocOpen,
  onToggleToc,
  tocBtnRef,
  showRailToggle,
  outlineRailOpen,
  toggleOutlineRail,
  starred,
  onToggleStar,
}: {
  showTocButton: boolean;
  tocOpen: boolean;
  onToggleToc: () => void;
  tocBtnRef: React.RefObject<HTMLButtonElement | null>;
  showRailToggle: boolean;
  outlineRailOpen: boolean;
  toggleOutlineRail: () => void;
  starred: boolean;
  onToggleStar: () => void;
}) {
  return (
    <div className="relative flex items-center gap-1 shrink-0">
      {showTocButton && (
        <Button
          ref={tocBtnRef}
          variant={tocOpen ? "secondary" : "ghost"}
          size="sm"
          className="max-lg:min-h-11 max-lg:px-3"
          aria-label="目录"
          aria-expanded={tocOpen}
          onClick={onToggleToc}
        >
          <ListTree className="h-3.5 w-3.5" />
          目录
        </Button>
      )}
      {showRailToggle && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={outlineRailOpen ? "隐藏大纲栏" : "显示大纲栏"}
          onClick={() => toggleOutlineRail()}
        >
          {outlineRailOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRight className="h-4 w-4" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={starred ? "取消收藏" : "收藏"}
        onClick={onToggleStar}
      >
        <Star
          className={cn("h-4 w-4", starred && "fill-[var(--gold)] text-[var(--gold)]")}
        />
      </Button>
    </div>
  );
}
