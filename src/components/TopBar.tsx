"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  Check,
  Link2,
  Copy,
  Download,
  ExternalLink,
  ListTree,
  Maximize2,
  Menu,
  History,
  MoreHorizontal,
  Network,
  SlidersHorizontal,
  PanelRight,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dropdown, DropdownItem } from "./ui/dropdown";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { DocAside, hasDocAsideContent } from "./DocAside";
import { getDocMeta } from "@/lib/docMeta";
import { findUnlinkedMentions } from "@/lib/wikilink";
import { useStore } from "@/lib/store";
import {
  extractOutline,
  OUTLINE_SPY_THRESHOLD_PX,
  resolveActiveHeadingId,
  measureHeadingContentTops,
  headingViewportTops,
  type HeadingContentTop,
} from "@/lib/outline";
import { findBacklinks } from "@/lib/search";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { basename, titleOf, cn, relativeTime } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";
import { getTags } from "@/lib/tags";
import {
  HTML_WIDTH_PX,
  HTML_ZOOM_OPTIONS,
  normalizeHtmlPrefs,
  type HtmlWidthMode,
} from "@/lib/htmlPreviewPrefs";
import { openHtmlInNewTab } from "./HtmlReader";

/** Ellipsis middle path segments; keep last two. */
function BreadcrumbPath({ path }: { path: string }) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  let shownDirs = dirs;
  let ellipsis = false;
  if (dirs.length > 2) {
    shownDirs = dirs.slice(-2);
    ellipsis = true;
  }
  return (
    <div className="min-w-0 truncate text-sm text-[var(--muted)] font-ui">
      {ellipsis && <span>… / </span>}
      {shownDirs.map((d, i) => (
        <span key={`${d}-${i}`}>
          {d}
          <span> / </span>
        </span>
      ))}
      <span className="font-serif font-bold text-[var(--fg)]">{titleOf(file)}</span>
    </div>
  );
}

export function TopBar() {
  const active = useStore((s) => s.getActive());
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const splitSourceFirst = useStore((s) => s.splitSourceFirst);
  const toggleSyncScroll = useStore((s) => s.toggleSyncScroll);
  const syncScrollOn = useStore((s) =>
    active ? s.getSyncScrollEnabled(active.id) : true
  );
  const toggleSplitSourceFirst = useStore((s) => s.toggleSplitSourceFirst);
  const saveDoc = useStore((s) => s.saveDoc);
  const isDirty = useStore((s) => s.isDirty);
  const toggleStar = useStore((s) => s.toggleStar);
  const renameDoc = useStore((s) => s.renameDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const discardDraft = useStore((s) => s.discardDraft);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setStatus = useStore((s) => s.setStatus);
  const outlineRailOpen = useStore((s) => s.outlineRailOpen);
  const toggleOutlineRail = useStore((s) => s.toggleOutlineRail);
  const setOutlineRailOpen = useStore((s) => s.setOutlineRailOpen);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const setHtmlImmersive = useStore((s) => s.setHtmlImmersive);
  const setHtmlPreviewPrefs = useStore((s) => s.setHtmlPreviewPrefs);
  const htmlPreviewPrefs = useStore((s) => s.htmlPreviewPrefs);
  const bumpHtmlReload = useStore((s) => s.bumpHtmlReload);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const setReadingPrefs = useStore((s) => s.setReadingPrefs);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setDocTags = useStore((s) => s.setDocTags);
  const setVersionDialogOpen = useStore((s) => s.setVersionDialogOpen);
  const setPropsDialogOpen = useStore((s) => s.setPropsDialogOpen);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);
  const annotations = useStore((s) => s.annotations);
  const assetsForDoc = useStore((s) => s.assetsForDoc);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [tocOpen, setTocOpen] = React.useState(false);
  const [activeHeading, setActiveHeading] = React.useState("");
  const headingTopsCacheRef = React.useRef<HeadingContentTop[] | null>(null);
  const tocBtnRef = React.useRef<HTMLButtonElement>(null);
  const tocPanelRef = React.useRef<HTMLDivElement>(null);
  const [tagsOpen, setTagsOpen] = React.useState(false);
  const [tagInput, setTagInput] = React.useState("");
  const tagsBtnRef = React.useRef<HTMLButtonElement>(null);
  const tagsPanelRef = React.useRef<HTMLDivElement>(null);

  const wide = useMediaQuery("(min-width: 1280px)");
  const dirty = active ? isDirty(active.id) : false;
  const isHtml = active?.type === "html";
  const htmlPrefs =
    active && isHtml
      ? normalizeHtmlPrefs(htmlPreviewPrefs[active.id])
      : null;
  const docTags =
    active ? getTags({ ...active, content: getContent(active.id) }) : [];

  const outline =
    active && active.type === "md" ? extractOutline(getContent(active.id)) : [];
  const backlinks = active ? findBacklinks(documents, active) : [];
  const mentionCount =
    active && active.type === "md"
      ? findUnlinkedMentions(
          getContent(active.id),
          documents
            .filter((d) => d.id !== active.id)
            .flatMap((d) => {
              const m = getDocMeta(d);
              return [titleOf(d.path), m.title, ...m.aliases];
            })
            .filter((x) => x && x.length >= 2),
          {
            excludeTitles: [
              titleOf(active.path),
              ...(() => {
                const m = getDocMeta({ ...active, content: getContent(active.id) });
                return [m.title, ...m.aliases];
              })(),
            ],
          }
        ).length
      : 0;
  const annotationCount = active
    ? annotations.filter((a) => a.docId === active.id).length
    : 0;
  const assetCount = active ? assetsForDoc(active.id).length : 0;
  const asideAvailable = hasDocAsideContent(outline, backlinks, mentionCount, annotationCount, assetCount);

  // Track active heading for popover outline (cached tops; same root as MD reader)
  React.useEffect(() => {
    if (!tocOpen && wide) return;
    const root = document.getElementById("reader-scroll");
    if (!root) return;
    headingTopsCacheRef.current = null;
    let raf = 0;
    const ensureHeads = () => {
      if (headingTopsCacheRef.current) return headingTopsCacheRef.current;
      const article = root.querySelector("article");
      const scope = (article as HTMLElement | null) ?? root;
      const measured = measureHeadingContentTops(root, scope);
      headingTopsCacheRef.current = measured;
      return measured;
    };
    const update = () => {
      raf = 0;
      const cached = ensureHeads();
      const rootTop = root.getBoundingClientRect().top;
      const heads = headingViewportTops(cached, root.scrollTop, rootTop);
      const current = resolveActiveHeadingId(heads, OUTLINE_SPY_THRESHOLD_PX);
      setActiveHeading((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    // Invalidate when article size changes (async images/mermaid)
    const article = root.querySelector("article");
    const ro =
      typeof ResizeObserver !== "undefined" && article
        ? new ResizeObserver(() => {
            headingTopsCacheRef.current = null;
          })
        : null;
    if (ro && article) ro.observe(article);
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tocOpen, wide, active?.id]);

  React.useEffect(() => {
    if (!tocOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (tocPanelRef.current?.contains(t)) return;
      if (tocBtnRef.current?.contains(t)) return;
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

  React.useEffect(() => {
    if (!tagsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (tagsPanelRef.current?.contains(t)) return;
      if (tagsBtnRef.current?.contains(t)) return;
      setTagsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tagsOpen]);

  const modes: { id: ViewMode; label: string }[] = [
    { id: "preview", label: "预览" },
    { id: "split", label: "分栏" },
    { id: "source", label: "源码" },
    // mixed demoted to command palette — preview supports click-to-edit
  ];

  const exportDoc = () => {
    if (!active) return;
    const blob = new Blob([getContent(active.id)], {
      type: active.type === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = basename(active.path);
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`已导出 ${basename(active.path)}`);
  };

  const copySource = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(getContent(active.id));
    setStatus("已复制源码");
  };

  const showTocButton = asideAvailable && (!wide || !outlineRailOpen);
  const showRailToggle = asideAvailable && wide;

  if (htmlImmersive && isHtml) {
    return null;
  }

  return (
    <>
      <header className="h-14 shrink-0 glass flex items-center gap-2 px-3 md:px-4 border-b border-[var(--border)]">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="打开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          {active ? (
            <>
              <BreadcrumbPath path={active.path} />
              {isHtml && (
                <span className="hidden sm:inline shrink-0 text-[11px] text-[var(--muted)] font-ui truncate">
                  HTML · 更新于 {relativeTime(active.updatedAt)}
                </span>
              )}
              {dirty && (
                <span className="shrink-0 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] px-2 py-0.5 border border-[var(--accent)]/20">
                  未保存
                </span>
              )}
            </>
          ) : (
            <div className="font-serif font-semibold">琅嬛 · 藏书阁</div>
          )}
        </div>

        {active && (
          <div className="flex items-center gap-3 shrink-0">
            {/* Group: view */}
            <div className="flex items-center gap-1">
              <div
                className="hidden sm:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
                role="tablist"
                aria-label="视图切换"
              >
                {modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={viewMode === m.id}
                    onClick={() => setViewMode(m.id)}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-[10px] transition-colors font-ui",
                      viewMode === m.id
                        ? "bg-[var(--accent)] text-white"
                        : "hover:bg-[var(--hover)]"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {viewMode === "split" && (
                <>
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
                    "hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)]",
                    "bg-[var(--card)] px-2.5 py-1 text-xs font-ui transition-colors",
                    "hover:bg-[var(--hover)] hover:border-[var(--accent)]/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                  )}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--muted)]" />
                  <span>{splitSourceFirst ? "源码在左" : "预览在左"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => active && toggleSyncScroll(active.id)}
                  title={syncScrollOn ? "关闭同步滚动（点击定位仍可用）" : "开启同步滚动"}
                  aria-label={syncScrollOn ? "同步滚动已开启" : "同步滚动已关闭"}
                  aria-pressed={syncScrollOn}
                  className={cn(
                    "hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)]",
                    "bg-[var(--card)] px-2.5 py-1 text-xs font-ui transition-colors",
                    "hover:bg-[var(--hover)] hover:border-[var(--accent)]/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
                    syncScrollOn && "border-[var(--accent)]/50 text-[var(--accent)]"
                  )}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{syncScrollOn ? "同步滚动" : "同步已关"}</span>
                </button>
                </>
              )}
            </div>

            {/* Group: save */}
            <div className="flex items-center gap-1">
              <Button
                variant={dirty ? "accent" : "outline"}
                size="sm"
                onClick={() => saveDoc(active.id)}
                aria-label="保存"
              >
                {dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {dirty ? "保存" : "已保存"}
              </Button>
            </div>

            {/* Group: HTML preview tools */}
            {isHtml && viewMode !== "source" && htmlPrefs && (
              <div className="flex items-center gap-1">
                <div
                  className="hidden md:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
                  role="group"
                  aria-label="宽度模拟"
                >
                  {(
                    [
                      ["fluid", "自适应"],
                      ["desktop", "桌面"],
                      ["tablet", "平板"],
                      ["phone", "手机"],
                    ] as [HtmlWidthMode, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setHtmlPreviewPrefs(active.id, { widthMode: id })
                      }
                      className={cn(
                        "px-2 py-1 text-[11px] rounded-[10px] font-ui transition-colors",
                        htmlPrefs.widthMode === id
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--hover)] text-[var(--muted)]"
                      )}
                      title={
                        id === "fluid"
                          ? "自适应宽度"
                          : `${HTML_WIDTH_PX[id as Exclude<HtmlWidthMode, "fluid">]}px`
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  className="hidden lg:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
                  role="group"
                  aria-label="缩放"
                >
                  {HTML_ZOOM_OPTIONS.map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setHtmlPreviewPrefs(active.id, { zoom: z })}
                      className={cn(
                        "px-2 py-1 text-[11px] rounded-[10px] font-ui tabular-nums",
                        htmlPrefs.zoom === z
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--hover)] text-[var(--muted)]"
                      )}
                    >
                      {Math.round(z * 100)}%
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="在新标签页打开"
                  title="在新标签页打开"
                  onClick={() => {
                    openHtmlInNewTab(getContent(active.id));
                    setStatus("已在新标签页打开");
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="刷新预览"
                  title="刷新预览"
                  onClick={() => {
                    bumpHtmlReload();
                    setStatus("已刷新预览");
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
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

            {/* MD reading tools */}
            {!isHtml && viewMode !== "source" && (
              <div className="flex items-center gap-1">
                <div
                  className="hidden md:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
                  role="group"
                  aria-label="字号"
                >
                  {[15, 17, 19, 21].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setReadingPrefs({ fontSize: sz })}
                      className={cn(
                        "px-2 py-1 text-[11px] rounded-[10px] font-ui tabular-nums",
                        readingPrefs.fontSize === sz
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--hover)] text-[var(--muted)]"
                      )}
                      title={`字号 ${sz}px`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
                <div
                  className="hidden lg:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
                  role="group"
                  aria-label="行宽"
                >
                  {(
                    [
                      [560, "窄"],
                      [680, "适中"],
                      [740, "默认"],
                      [900, "宽"],
                    ] as [number, string][]
                  ).map(([w, label]) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setReadingPrefs({ lineWidth: w })}
                      className={cn(
                        "px-2 py-1 text-[11px] rounded-[10px] font-ui",
                        readingPrefs.lineWidth === w
                          ? "bg-[var(--accent)] text-white"
                          : "hover:bg-[var(--hover)] text-[var(--muted)]"
                      )}
                      title={`行宽 ${w}px`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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

            {/* HTML tags popover (all view modes) */}
            {isHtml && (
              <div className="relative">
                <Button
                  ref={tagsBtnRef}
                  variant={tagsOpen ? "secondary" : "ghost"}
                  size="sm"
                  aria-label="标签"
                  aria-expanded={tagsOpen}
                  onClick={() => setTagsOpen((v) => !v)}
                >
                  <Tag className="h-3.5 w-3.5" />
                  标签 ({docTags.length})
                </Button>
                {tagsOpen && (
                  <div
                    ref={tagsPanelRef}
                    className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl animate-enter"
                  >
                    <div className="mb-2 text-xs text-[var(--muted)] font-ui">文档标签</div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {docTags.length === 0 && (
                        <span className="text-xs text-[var(--muted)]">暂无标签</span>
                      )}
                      {docTags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
                        >
                          {t}
                          <button
                            type="button"
                            aria-label={`删除标签 ${t}`}
                            className="hover:text-[var(--accent)]"
                            onClick={() =>
                              setDocTags(
                                active.id,
                                docTags.filter((x) => x !== t)
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const next = tagInput.trim();
                        if (!next || docTags.includes(next)) return;
                        setDocTags(active.id, [...docTags, next]);
                        setTagInput("");
                      }}
                      className="flex gap-1.5"
                    >
                      <Input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
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
            )}

            {/* Group: other */}
            <div className="relative flex items-center gap-1">
              {showTocButton && (
                <Button
                  ref={tocBtnRef}
                  variant={tocOpen ? "secondary" : "ghost"}
                  size="sm"
                  aria-label="目录"
                  aria-expanded={tocOpen}
                  onClick={() => setTocOpen((v) => !v)}
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
                aria-label={active.starred ? "取消收藏" : "收藏"}
                onClick={() => toggleStar(active.id)}
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    active.starred && "fill-[var(--gold)] text-[var(--gold)]"
                  )}
                />
              </Button>
              <Dropdown
                align="right"
                trigger={
                  <Button variant="ghost" size="icon" aria-label="更多">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              >
                <DropdownItem
                  onClick={() => {
                    setRenameVal(active.path);
                    setRenameOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> 重命名 / 移动
                </DropdownItem>
                <DropdownItem onClick={() => setExportDialogOpen(true)}>
                  <Download className="h-3.5 w-3.5" /> 导出…
                </DropdownItem>
                <DropdownItem onClick={exportDoc}>
                  <Download className="h-3.5 w-3.5" /> 快速导出源码
                </DropdownItem>
                <DropdownItem onClick={copySource}>
                  <Copy className="h-3.5 w-3.5" /> 复制源码
                </DropdownItem>
                {asideAvailable && (
                  <DropdownItem
                    onClick={() => {
                      if (wide) toggleOutlineRail();
                      else {
                        setTocOpen(true);
                        setOutlineRailOpen(true);
                      }
                    }}
                  >
                    <PanelRight className="h-3.5 w-3.5" />
                    {wide
                      ? outlineRailOpen
                        ? "隐藏大纲栏"
                        : "显示大纲栏"
                      : "打开目录"}
                  </DropdownItem>
                )}
                <DropdownItem onClick={() => setPropsDialogOpen(true)}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> 属性面板
                </DropdownItem>
                <DropdownItem onClick={() => setGraphDialogOpen(true)}>
                  <Network className="h-3.5 w-3.5" /> 知识图谱
                </DropdownItem>
                <DropdownItem onClick={() => setVersionDialogOpen(true)}>
                  <History className="h-3.5 w-3.5" /> 版本历史
                </DropdownItem>
                <DropdownItem onClick={() => discardDraft(active.id)} disabled={!dirty}>
                  <X className="h-3.5 w-3.5" /> 放弃修改
                </DropdownItem>
                <DropdownItem danger onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> 删除
                </DropdownItem>
              </Dropdown>
              <Button
                variant="ghost"
                size="icon"
                aria-label="搜索"
                onClick={() => setCommandOpen(true)}
              >
                <Search className="h-4 w-4" />
              </Button>

              {tocOpen && (
                <div
                  ref={tocPanelRef}
                  className="absolute right-0 top-full z-40 mt-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl animate-enter"
                >
                  <DocAside
                    outline={outline}
                    backlinks={backlinks}
                    activeHeading={activeHeading}
                    variant="popover"
                    doc={active}
                    onNavigateHeading={setActiveHeading}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {!active && (
          <Button variant="ghost" size="icon" aria-label="搜索" onClick={() => setCommandOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
        )}
      </header>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} labelledBy="rename-title">
        <div className="p-5 space-y-3">
          <h2 id="rename-title" className="font-serif text-lg font-semibold">
            重命名 / 移动
          </h2>
          <p className="text-sm text-[var(--muted)]">
            路径里写 <code className="font-mono">/</code> 即可换目录，例如{" "}
            <code className="font-mono">笔记/新名字.md</code>
          </p>
          <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (active && renameVal.trim()) {
                  renameDoc(active.id, renameVal.trim());
                  setRenameOpen(false);
                }
              }}
            >
              确定
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} labelledBy="delete-title">
        <div className="p-5 space-y-3">
          <h2 id="delete-title" className="font-serif text-lg font-semibold">
            移入回收站？
          </h2>
          <p className="text-sm text-[var(--muted)]">
            将「{active ? titleOf(active.path) : ""}」移入回收站，可在 30 天内恢复。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (active) {
                  deleteDoc(active.id);
                  setDeleteOpen(false);
                }
              }}
            >
              删除
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
