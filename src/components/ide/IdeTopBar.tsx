"use client";

import {
  ArrowLeftRight,
  FolderOpen,
  Menu,
  PanelLeft,
  Save,
  BookOpen,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import { useStore } from "@/lib/store";
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
  const requestSwitchToNotes = useIdeStore((s) => s.requestSwitchToNotes);
  const status = useIdeStore((s) => s.status);
  const setAppMode = useStore((s) => s.setAppMode);
  const isLg = useMediaQuery("(min-width: 1024px)");

  const dirty = activePath ? isDirty(activePath) : false;

  const goNotes = () => {
    if (requestSwitchToNotes()) setAppMode("notes");
  };

  return (
    <header
      className={cn(
        "h-12 shrink-0 flex items-center gap-1.5 px-2 border-b border-[var(--chrome-border)] bg-[var(--chrome)]"
      )}
    >
      {!isLg && (
        <Button variant="ghost" size="icon" aria-label="资源管理器" onClick={onToggleExplorer}>
          <Menu className="h-4 w-4" />
        </Button>
      )}
      {isLg && (
        <Button variant="ghost" size="icon" aria-label="切换资源管理器" onClick={onToggleExplorer}>
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      <div className="min-w-0 flex-1 px-1">
        <div className="font-serif text-sm font-semibold truncate">
          {session ? session.name : "IDE"}
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

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        disabled={!activePath || !dirty}
        onClick={() => void saveFile(activePath)}
        title="保存 (⌘/Ctrl+S) · 格式化 Shift+Alt+F · 转到定义 F12"
      >
        <Save className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">保存</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => void openFolder()}
        title="打开文件夹"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">打开</span>
      </Button>

      {session && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => closeProject()}
          title="关闭工程"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">关闭工程</span>
        </Button>
      )}

      <Button
        variant={explainOpen ? "secondary" : "ghost"}
        size="sm"
        className="gap-1.5"
        onClick={onToggleExplain}
        title="讲解 (⌘/Ctrl+Shift+L)"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">讲解</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 ml-1"
        onClick={goNotes}
        title="切回笔记模式"
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">笔记</span>
        <ArrowLeftRight className="h-3 w-3 opacity-60" />
      </Button>
    </header>
  );
}
