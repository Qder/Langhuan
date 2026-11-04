"use client";

import {
  ArrowLeftRight,
  Blend,
  Check,
  Copy,
  Download,
  History,
  Link2,
  Maximize2,
  MoreHorizontal,
  Network,
  PanelRight,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { Dropdown, DropdownItem } from "../ui/dropdown";
import { viewModesFor } from "./ViewModeSegment";
import type { Document, ViewMode } from "@/lib/types";

/**
 * 更多 — the overflow menu.
 *
 * On phones this is the *only* place the view modes exist besides 阅读, so the
 * three-mode list is repeated here deliberately (same `viewModesFor` source of
 * truth as the header segment). Everything else is the document actions that
 * only fit on wide screens.
 */
export function MoreMenu({
  active,
  viewMode,
  setViewMode,
  tabletUp,
  isHtml,
  wide,
  asideAvailable,
  outlineRailOpen,
  mdFocusMode,
  setMdFocusMode,
  setHtmlImmersive,
  splitSourceFirst,
  toggleSplitSourceFirst,
  syncScrollOn,
  toggleSyncScroll,
  toggleStar,
  toggleOutlineRail,
  setTocOpen,
  setOutlineRailOpen,
  setRenameVal,
  setRenameOpen,
  setExportDialogOpen,
  exportDoc,
  copySource,
  setSettingsDialogOpen,
  setPropsDialogOpen,
  setGraphDialogOpen,
  setVersionDialogOpen,
  discardDraft,
  dirty,
  setDeleteOpen,
  setStatus,
  touchIcon,
}: {
  active: Document | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  tabletUp: boolean;
  isHtml: boolean;
  wide: boolean;
  asideAvailable: boolean;
  outlineRailOpen: boolean;
  mdFocusMode: boolean;
  setMdFocusMode: (on: boolean) => void;
  setHtmlImmersive: (on: boolean) => void;
  splitSourceFirst: boolean;
  toggleSplitSourceFirst: () => void;
  syncScrollOn: boolean;
  toggleSyncScroll: (id: string) => void;
  toggleStar: (id: string) => void;
  toggleOutlineRail: () => void;
  setTocOpen: (open: boolean) => void;
  setOutlineRailOpen: (open: boolean) => void;
  setRenameVal: (value: string) => void;
  setRenameOpen: (open: boolean) => void;
  setExportDialogOpen: (open: boolean) => void;
  exportDoc: () => void;
  copySource: () => void | Promise<void>;
  setSettingsDialogOpen: (open: boolean) => void;
  setPropsDialogOpen: (open: boolean) => void;
  setGraphDialogOpen: (open: boolean) => void;
  setVersionDialogOpen: (open: boolean) => void;
  discardDraft: (id: string) => void;
  dirty: boolean;
  setDeleteOpen: (open: boolean) => void;
  setStatus: (msg: string) => void;
  touchIcon: string;
}) {
  if (!active) return null;

  return (
    <Dropdown
      align="right"
      trigger={
        <Button variant="ghost" size="icon" className={touchIcon} aria-label="更多">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      }
    >
      {/* View modes — required on phone where segment is hidden */}
      {viewModesFor(tabletUp).map((m) => (
        <DropdownItem key={`view-${m.id}`} onClick={() => setViewMode(m.id)}>
          {viewMode === m.id ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <span className="inline-block w-3.5" />
          )}
          {m.label}
        </DropdownItem>
      ))}
      {viewMode === "split" && tabletUp && (
        <>
          <DropdownItem onClick={() => toggleSplitSourceFirst()}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {splitSourceFirst ? "改为预览在左" : "改为源码在左"}
          </DropdownItem>
          <DropdownItem onClick={() => toggleSyncScroll(active.id)}>
            <Link2 className="h-3.5 w-3.5" />
            {syncScrollOn ? "关闭同步滚动" : "开启同步滚动"}
          </DropdownItem>
        </>
      )}
      <DropdownItem
        onClick={() => {
          if (active.type !== "md") {
            setStatus("混合模式仅支持 Markdown");
            return;
          }
          setViewMode("mixed");
          setStatus("已切换到混合模式");
        }}
      >
        <Blend className="h-3.5 w-3.5" /> 混合编辑
      </DropdownItem>
      <DropdownItem onClick={() => toggleStar(active.id)}>
        <Star className="h-3.5 w-3.5" />
        {active.starred ? "取消收藏" : "收藏"}
      </DropdownItem>
      {!isHtml && (
        <DropdownItem onClick={() => setMdFocusMode(!mdFocusMode)}>
          <Maximize2 className="h-3.5 w-3.5" />
          {mdFocusMode ? "退出专注" : "专注模式"}
        </DropdownItem>
      )}
      {isHtml && viewMode !== "source" && (
        <DropdownItem onClick={() => setHtmlImmersive(true)}>
          <Maximize2 className="h-3.5 w-3.5" /> 沉浸模式
        </DropdownItem>
      )}
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
      <DropdownItem onClick={() => setSettingsDialogOpen(true)}>
        <Settings2 className="h-3.5 w-3.5" /> 设置
      </DropdownItem>
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
  );
}
