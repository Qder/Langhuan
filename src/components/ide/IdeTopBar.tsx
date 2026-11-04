"use client";

import {
  FolderOpen,
  Menu,
  PanelLeft,
  Save,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import { AppModeSwitch } from "../AppModeSwitch";
import { useIdeStore } from "@/lib/ide/store";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

export function IdeTopBar({
  onToggleExplorer,
  onToggleExplain,
  explainOpen,
}: {
  onToggleExplorer: () => void;
  onToggleExplain: () => void;
  explainOpen: boolean;
}) {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const isDirty = useIdeStore((s) => s.isDirty);
  const saveFile = useIdeStore((s) => s.saveFile);
  const openFolder = useIdeStore((s) => s.openFolder);
  const closeProject = useIdeStore((s) => s.closeProject);
  const status = useIdeStore((s) => s.status);
  const isLg = useMediaQuery("(min-width: 1024px)");

  const dirty = activePath ? isDirty(activePath) : false;

  return (
    <header
      className={cn(
        "h-14 shrink-0 flex items-center gap-1.5 px-2 md:px-3 border-b border-[var(--chrome-border)] bg-[var(--chrome)] overflow-hidden"
      )}
    >
      {!isLg && (
        <Button
          variant="ghost"
          size="icon"
          className="max-lg:h-11 max-lg:w-11"
          aria-label="资源管理器"
          onClick={onToggleExplorer}
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}
      {isLg && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换资源管理器"
          onClick={onToggleExplorer}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      <div className="min-w-0 flex-1 px-1">
        <div className="font-serif text-sm font-semibold truncate">
          {session ? session.name : "琅嬛 · 读码"}
          {activePath ? (
            <span className="font-ui font-normal text-[var(--muted)]">
              {" · "}
              {dirty ? "● " : ""}
              {activePath.replace(/\\/g, "/")}
            </span>
          ) : null}
        </div>
        {status && (
          <div className="text-[10px] text-[var(--muted)] truncate font-ui">{status}</div>
        )}
      </div>

      {session ? (
        <Button
          variant={explainOpen ? "secondary" : "accent"}
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={onToggleExplain}
          title="讲解 (⌘/Ctrl+Shift+L)"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">讲解</span>
        </Button>
      ) : (
        <Button
          variant="accent"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => void openFolder()}
          title="打开文件夹"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">打开文件夹</span>
        </Button>
      )}

      {dirty && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => void saveFile(activePath)}
          title="保存 (⌘/Ctrl+S)"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">保存</span>
        </Button>
      )}

      {session && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0 hidden sm:inline-flex"
            onClick={() => void openFolder()}
            title="打开文件夹"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden md:inline">打开</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0 hidden md:inline-flex"
            onClick={() => closeProject()}
            title="关闭工程"
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">关闭工程</span>
          </Button>
        </>
      )}

      <AppModeSwitch className="ml-1" />
    </header>
  );
}
