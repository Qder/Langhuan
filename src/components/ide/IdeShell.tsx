"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import { IdeTopBar } from "./IdeTopBar";
import { IdeExplorer } from "./IdeExplorer";
import { IdeTabBar } from "./IdeTabBar";
import { IdeEditor } from "./IdeEditor";
import { IdeWelcome } from "./IdeWelcome";
import { IdeDirtyCloseDialog } from "./IdeDirtyCloseDialog";
import { IdeExplainPanel } from "./IdeExplainPanel";
import { IdeQuickOpen } from "./IdeQuickOpen";
import { IdeGotoLine } from "./IdeGotoLine";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

export function IdeShell() {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const explorerOpen = useIdeStore((s) => s.explorerOpen);
  const setExplorerOpen = useIdeStore((s) => s.setExplorerOpen);
  const explainOpen = useIdeStore((s) => s.explainOpen);
  const setExplainOpen = useIdeStore((s) => s.setExplainOpen);
  const toggleExplainOpen = useIdeStore((s) => s.toggleExplainOpen);
  const anyDirty = useIdeStore((s) => s.anyDirty);
  const status = useIdeStore((s) => s.status);
  const setStatus = useIdeStore((s) => s.setStatus);
  const isLg = useMediaQuery("(min-width: 1024px)");
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [gotoLineOpen, setGotoLineOpen] = React.useState(false);

  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // Esc closes tablet explorer drawer (explain panel has its own close)
  React.useEffect(() => {
    if (isLg || !explorerOpen || !session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExplorerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLg, explorerOpen, session, setExplorerOpen]);

  // Mod+L toggles explain panel
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "l") return;
      // Avoid stealing browser location bar if any — still match IDE habit.
      e.preventDefault();
      toggleExplainOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleExplainOpen]);

  // Mod+P quick open (IDE-only shell; notes ⌘K stays in notes AppShell)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      // Palette is the intent for Mod+P (including when focus is in an input).
      e.preventDefault();
      if (!session) setStatus("先打开文件夹");
      setQuickOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, setStatus]);

  // Mod+G go to line
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "g") return;
      e.preventDefault();
      if (!activePath) {
        setStatus("请先打开一个文件");
        return;
      }
      setGotoLineOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath, setStatus]);

  const showDrawer = !!session && explorerOpen && !isLg;
  const showDocked = !!session && explorerOpen && isLg;

  return (
    <div className="h-dvh flex flex-col overflow-hidden text-[var(--fg)] relative">
      <IdeTopBar
        onToggleExplorer={() => setExplorerOpen(!explorerOpen)}
        onToggleExplain={() => setExplainOpen(!explainOpen)}
        explainOpen={explainOpen}
      />
      <div className="flex-1 min-h-0 flex relative">
        {showDocked && <IdeExplorer />}

        {/* Tablet drawer explorer */}
        {showDrawer && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-30 bg-black/35"
              aria-label="关闭资源管理器"
              onClick={() => setExplorerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-40 shadow-2xl animate-enter">
              <IdeExplorer />
            </div>
          </>
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
          {!session ? (
            <IdeWelcome />
          ) : (
            <>
              <IdeTabBar />
              <div className="flex-1 min-h-0">
                {activePath ? (
                  <IdeEditor key={activePath} path={activePath} />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--muted)] font-ui px-6 text-center">
                    从左侧资源管理器打开一个文件开始编辑。
                    <br />
                    修改后 ⌘/Ctrl+S 写回磁盘；关闭未保存标签会提示。
                    <br />
                    ⌘/Ctrl+P 快速打开；⌘/Ctrl+G 转到行；⌘/Ctrl+L 打开讲解面板。
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {explainOpen && isLg && (
          <IdeExplainPanel onClose={() => setExplainOpen(false)} />
        )}
        {explainOpen && !isLg && (
          <IdeExplainPanel onClose={() => setExplainOpen(false)} />
        )}
      </div>
      <IdeQuickOpen open={quickOpen} onClose={() => setQuickOpen(false)} />
      <IdeGotoLine open={gotoLineOpen} onClose={() => setGotoLineOpen(false)} />
      <IdeDirtyCloseDialog />
      <div
        className={cn(
          "h-7 shrink-0 flex items-center px-3 text-[11px] font-ui border-t border-[var(--chrome-border)] bg-[var(--chrome)] text-[var(--muted)]"
        )}
      >
        <span className="truncate">
          {status || "IDE · 工程与笔记库隔离 · ⌘/Ctrl+L 讲解"}
        </span>
      </div>
    </div>
  );
}
