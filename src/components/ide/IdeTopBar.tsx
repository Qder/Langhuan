"use client";

import {
  FolderOpen,
  ListTree,
  Menu,
  MoreHorizontal,
  PanelLeft,
  Save,
  Search,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import { Dropdown, DropdownItem } from "../ui/dropdown";
import { AppModeSwitch } from "../AppModeSwitch";
import { IdeOutlineToggle } from "./IdeOutlineRail";
import { useIdeStore } from "@/lib/ide/store";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { IDE_WIDE_QUERY } from "@/lib/ide/panelLayers";
import { getIdeFsCapability } from "@/lib/ide/ideFs";
import { cn } from "@/lib/utils";

export function IdeTopBar({
  onToggleExplorer,
  onToggleExplain,
  onOpenWorkspaceSearch,
  explainOpen,
  outlineOpen,
  onToggleOutline,
  canToggleOutline,
}: {
  onToggleExplorer: () => void;
  onToggleExplain: () => void;
  /** 工程内搜索 — same action as Mod+Shift+F and the command palette. */
  onOpenWorkspaceSearch: () => void;
  explainOpen: boolean;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  canToggleOutline: boolean;
}) {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const isDirty = useIdeStore((s) => s.isDirty);
  const saveFile = useIdeStore((s) => s.saveFile);
  const openFolder = useIdeStore((s) => s.openFolder);
  const closeProject = useIdeStore((s) => s.closeProject);
  const isLg = useMediaQuery(IDE_WIDE_QUERY);
  // 当前环境能不能选目录 —— Android WebView 名义上有 API，实际会让文件选择器 NPE。
  const canPickFolder = getIdeFsCapability().canPickFolder;

  const dirty = activePath ? isDirty(activePath) : false;

  return (
    <header className="h-14 shrink-0 flex items-center gap-1.5 px-2 md:px-3 border-b border-[var(--chrome-border)] bg-[var(--chrome)] overflow-hidden">
      {!isLg ? (
        <Button
          variant="ghost"
          size="icon"
          className="max-lg:h-11 max-lg:w-11"
          aria-label="文件"
          onClick={onToggleExplorer}
        >
          <Menu className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换文件树"
          onClick={onToggleExplorer}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Title only — status lives in the bottom bar, never mirrored here. */}
      <div className="min-w-0 flex-1 px-1">
        <div className="font-serif text-sm font-semibold truncate">
          {session ? session.name : "琅嬛 · 读码"}
          {activePath ? (
            <span className="hidden sm:inline font-ui font-normal text-[var(--muted)]">
              {" · "}
              {dirty ? "● " : ""}
              {activePath.replace(/\\/g, "/")}
            </span>
          ) : null}
        </div>
      </div>

      {canToggleOutline && (
        <IdeOutlineToggle open={outlineOpen} onToggle={onToggleOutline} />
      )}

      {dirty && (
        <Button
          variant="ghost"
          size="icon"
          className="max-lg:h-11 max-lg:w-11 shrink-0"
          onClick={() => void saveFile(activePath)}
          title="保存 (⌘/Ctrl+S)"
          aria-label="保存"
        >
          <Save className="h-4 w-4" />
        </Button>
      )}

      {session ? (
        <Button
          variant={explainOpen ? "secondary" : "accent"}
          size="sm"
          className="gap-1.5 shrink-0 max-lg:h-11 max-lg:px-3"
          onClick={onToggleExplain}
          title="讲解 (⌘/Ctrl+Shift+L)"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>讲解</span>
        </Button>
      ) : canPickFolder ? (
        <Button
          variant="accent"
          size="sm"
          className="gap-1.5 shrink-0 max-lg:h-11 max-lg:px-3"
          onClick={() => void openFolder()}
          title="打开文件夹"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>打开文件夹</span>
        </Button>
      ) : (
        // 没目录选择能力（Android WebView / 无 FSA 的桌面 WebView）时不给假按钮：
        // 点了只会走一条会崩的路径，改成一句诚实的说明。
        <span className="shrink-0 max-w-[45%] truncate text-xs text-[var(--muted)] font-ui px-1">
          读码需桌面版
        </span>
      )}

      <Dropdown
        align="right"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="max-lg:h-11 max-lg:w-11 shrink-0"
            aria-label="更多"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      >
        {session ? (
          <>
            <DropdownItem onClick={onOpenWorkspaceSearch}>
              <Search className="h-3.5 w-3.5" /> 在工程中搜索
            </DropdownItem>
            <DropdownItem onClick={() => void openFolder()}>
              <FolderOpen className="h-3.5 w-3.5" /> 打开文件夹…
            </DropdownItem>
            <DropdownItem onClick={() => closeProject()}>
              <X className="h-3.5 w-3.5" /> 关闭工程
            </DropdownItem>
            {/* Below lg the toolbar has no room for a fourth icon — outline lives here. */}
            {canToggleOutline && !isLg && (
              <DropdownItem onClick={onToggleOutline}>
                <ListTree className="h-3.5 w-3.5" />
                {outlineOpen ? "隐藏大纲" : "当前文件大纲"}
              </DropdownItem>
            )}
            <DropdownItem
              disabled={!dirty}
              onClick={() => void saveFile(activePath)}
            >
              <Save className="h-3.5 w-3.5" /> 保存当前文件
            </DropdownItem>
          </>
        ) : canPickFolder ? (
          <DropdownItem onClick={() => void openFolder()}>
            <FolderOpen className="h-3.5 w-3.5" /> 打开文件夹…
          </DropdownItem>
        ) : (
          <DropdownItem disabled onClick={() => void openFolder()}>
            <FolderOpen className="h-3.5 w-3.5" /> 读码需桌面版（本机不能选目录）
          </DropdownItem>
        )}
      </Dropdown>

      <AppModeSwitch className={cn("ml-0.5")} />
    </header>
  );
}
