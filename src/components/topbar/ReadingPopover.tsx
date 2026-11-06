"use client";

import {
  ArrowDownToLine,
  ArrowLeftRight,
  ExternalLink,
  Link2,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "../ui/button";
import { SegButton, SegGroup } from "./SegControl";
import { viewModesFor } from "./ViewModeSegment";
import { cn } from "@/lib/utils";
import {
  HTML_WIDTH_PX,
  HTML_ZOOM_OPTIONS,
  type HtmlWidthMode,
} from "@/lib/htmlPreviewPrefs";
import type { HtmlDocPreviewPrefs } from "@/lib/htmlPreviewPrefs";
import type { ReadingPrefs } from "@/lib/readingPrefs";
import {
  LINE_HEIGHT_OPTIONS,
  PARAGRAPH_SPACING_OPTIONS,
  ZOOM_OPTIONS,
} from "@/lib/readingPrefs";
import { ReadingStatsCard, useReadingStats } from "../ReadingStatsCard";
import type { ViewMode } from "@/lib/types";

/**
 * 阅读 — the single entry for every reading preference, on every width.
 *
 * Tiering contract kept from before the split:
 *  - below sm the header has no view segment, so 视图 is repeated here;
 *  - below lg the panel is pinned to the viewport (the trigger sits mid-header,
 *    so `right-0` would push a 20rem panel off-screen);
 *  - MD-only groups hide in 源码, and HTML-only groups disappear for MD.
 */
export function ReadingPopover({
  open,
  onToggle,
  buttonRef,
  panelRef,
  viewMode,
  setViewMode,
  tabletUp,
  isHtml,
  htmlPrefs,
  activeId,
  content,
  readingPrefs,
  setReadingPrefs,
  mdFocusMode,
  setMdFocusMode,
  setHtmlImmersive,
  setHtmlPreviewPrefs,
  bumpHtmlReload,
  splitSourceFirst,
  toggleSplitSourceFirst,
  syncScrollOn,
  toggleSyncScroll,
  setStatus,
  touchIcon,
  openHtmlInNewTab,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  tabletUp: boolean;
  isHtml: boolean;
  htmlPrefs: HtmlDocPreviewPrefs | null;
  activeId: string;
  content: string;
  readingPrefs: ReadingPrefs;
  setReadingPrefs: (patch: Partial<ReadingPrefs>) => void;
  mdFocusMode: boolean;
  setMdFocusMode: (on: boolean) => void;
  setHtmlImmersive: (on: boolean) => void;
  setHtmlPreviewPrefs: (id: string, patch: Partial<HtmlDocPreviewPrefs>) => void;
  bumpHtmlReload: () => void;
  splitSourceFirst: boolean;
  toggleSplitSourceFirst: () => void;
  syncScrollOn: boolean;
  toggleSyncScroll: (id: string) => void;
  setStatus: (msg: string) => void;
  touchIcon: string;
  openHtmlInNewTab: (html: string) => void;
  onClose: () => void;
}) {
  // 篇级统计：和阅读偏好同处一个弹层，专注模式里也是从这里看字数与时长。
  const stats = useReadingStats(content, isHtml ? "html" : "md");

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant={open ? "secondary" : "ghost"}
        size="icon"
        className={touchIcon}
        aria-label="阅读设置"
        aria-expanded={open}
        title="阅读：字号 / 行宽 / 缩放 / 行高 / 专注"
        onClick={onToggle}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          ref={panelRef}
          className={cn(
            "z-40 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl animate-enter space-y-3",
            // Below lg the button sits mid-header, so `right-0` would
            // push a 20rem panel off-screen — pin it to the viewport.
            "fixed left-2 right-2 top-[3.75rem] max-h-[calc(100dvh-5rem)] overflow-y-auto",
            "sm:left-auto sm:right-2 sm:w-[20rem]",
            "lg:absolute lg:top-full lg:mt-2 lg:w-[20rem] lg:max-h-none lg:overflow-visible"
          )}
        >
          <div className="text-xs font-ui font-semibold">阅读</div>

          <ReadingStatsCard stats={stats} />

          {/* Phone only: the sm+ toolbar already has the 预览|源码 segment */}
          <div className="sm:hidden">
            <SegGroup label="视图">
              {viewModesFor(tabletUp).map((m) => (
                <SegButton
                  key={`rp-${m.id}`}
                  active={viewMode === m.id}
                  onClick={() => setViewMode(m.id)}
                >
                  {m.label}
                </SegButton>
              ))}
            </SegGroup>
          </div>

          {!isHtml && viewMode !== "source" && (
            <>
              <SegGroup label="字号">
                {[15, 17, 19, 21].map((sz) => (
                  <SegButton
                    key={`rp-fs-${sz}`}
                    active={readingPrefs.fontSize === sz}
                    title={`字号 ${sz}px`}
                    onClick={() => setReadingPrefs({ fontSize: sz })}
                  >
                    {sz}
                  </SegButton>
                ))}
              </SegGroup>
              <SegGroup label="行宽">
                {(
                  [
                    [560, "窄"],
                    [680, "适中"],
                    [740, "默认"],
                    [900, "宽"],
                  ] as [number, string][]
                ).map(([w, label]) => (
                  <SegButton
                    key={`rp-lw-${w}`}
                    active={readingPrefs.lineWidth === w}
                    title={`行宽 ${w}px`}
                    onClick={() => setReadingPrefs({ lineWidth: w })}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegGroup>
              <SegGroup label="缩放">
                {ZOOM_OPTIONS.map(({ value, label }) => (
                  <SegButton
                    key={`rp-zoom-${value}`}
                    active={readingPrefs.zoom === value}
                    title={`正文缩放 ${label}`}
                    onClick={() => setReadingPrefs({ zoom: value })}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegGroup>
              <SegGroup label="行高">
                {LINE_HEIGHT_OPTIONS.map(({ value, label }) => (
                  <SegButton
                    key={`rp-lh-${value}`}
                    active={readingPrefs.lineHeight === value}
                    title={`行高 ${value}`}
                    onClick={() => setReadingPrefs({ lineHeight: value })}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegGroup>
              <SegGroup label="段距">
                {PARAGRAPH_SPACING_OPTIONS.map(({ value, label }) => (
                  <SegButton
                    key={`rp-ps-${value}`}
                    active={readingPrefs.paragraphSpacing === value}
                    title={`段距 ${value}em`}
                    onClick={() => setReadingPrefs({ paragraphSpacing: value })}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegGroup>
              <button
                type="button"
                onClick={() => setMdFocusMode(!mdFocusMode)}
                aria-pressed={mdFocusMode}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-ui",
                  mdFocusMode
                    ? "border-[var(--accent)]/50 text-[var(--accent)]"
                    : "hover:bg-[var(--hover)]"
                )}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                {mdFocusMode ? "退出专注模式" : "专注模式"}
              </button>
            </>
          )}

          {/* 打字机滚动：源码 / 混合模式 / 分栏都生效，所以放在 viewMode 判断之外——
              源码模式恰恰是最需要它的时候，藏在「非源码」里等于没法用。
              HTML 文档没有可跟随的编辑光标，不显示。 */}
          {!isHtml && (
            <button
              type="button"
              onClick={() => setReadingPrefs({ typewriterMode: !readingPrefs.typewriterMode })}
              aria-pressed={readingPrefs.typewriterMode}
              title={
                readingPrefs.typewriterMode
                  ? "关闭后恢复普通滚动"
                  : "编辑时当前行 / 当前块保持视口中线"
              }
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-ui",
                readingPrefs.typewriterMode
                  ? "border-[var(--accent)]/50 text-[var(--accent)]"
                  : "hover:bg-[var(--hover)]"
              )}
            >
              <span className="flex items-center gap-2">
                <ArrowDownToLine className="h-3.5 w-3.5" />
                打字机滚动
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                {readingPrefs.typewriterMode ? "开" : "关"}
              </span>
            </button>
          )}

          {isHtml && viewMode !== "source" && htmlPrefs && (
            <>
              <SegGroup label="宽度">
                {(
                  [
                    ["fluid", "自适应"],
                    ["desktop", "桌面"],
                    ["tablet", "平板"],
                    ["phone", "手机"],
                  ] as [HtmlWidthMode, string][]
                ).map(([id, label]) => (
                  <SegButton
                    key={`rp-w-${id}`}
                    active={htmlPrefs.widthMode === id}
                    title={
                      id === "fluid"
                        ? "自适应宽度"
                        : `${HTML_WIDTH_PX[id as Exclude<HtmlWidthMode, "fluid">]}px`
                    }
                    onClick={() => setHtmlPreviewPrefs(activeId, { widthMode: id })}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegGroup>
              <SegGroup label="缩放">
                {HTML_ZOOM_OPTIONS.map((z) => (
                  <SegButton
                    key={`rp-z-${z}`}
                    active={htmlPrefs.zoom === z}
                    onClick={() => setHtmlPreviewPrefs(activeId, { zoom: z })}
                  >
                    {Math.round(z * 100)}%
                  </SegButton>
                ))}
              </SegGroup>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    openHtmlInNewTab(content);
                    setStatus("已在新标签页打开");
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  新标签页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    bumpHtmlReload();
                    setStatus("已刷新预览");
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setHtmlImmersive(true);
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-ui hover:bg-[var(--hover)]"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                沉浸模式
              </button>
            </>
          )}

          {viewMode === "split" && tabletUp && (
            <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
              <button
                type="button"
                onClick={() => toggleSplitSourceFirst()}
                className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-ui hover:bg-[var(--hover)]"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {splitSourceFirst ? "改为预览在左" : "改为源码在左"}
              </button>
              <button
                type="button"
                onClick={() => toggleSyncScroll(activeId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-ui hover:bg-[var(--hover)]",
                  syncScrollOn && "border-[var(--accent)]/50 text-[var(--accent)]"
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                {syncScrollOn ? "关闭同步滚动" : "开启同步滚动"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
