"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import { IdeTopBar } from "./IdeTopBar";
import { IdeExplorer } from "./IdeExplorer";
import { IdeTabBar } from "./IdeTabBar";
import { IdeEditor } from "./IdeEditor";
import { IdeWelcome } from "./IdeWelcome";
import { IdeDirtyCloseDialog } from "./IdeDirtyCloseDialog";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

export function IdeShell() {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const explorerOpen = useIdeStore((s) => s.explorerOpen);
  const setExplorerOpen = useIdeStore((s) => s.setExplorerOpen);
  const anyDirty = useIdeStore((s) => s.anyDirty);
  const isLg = useMediaQuery("(min-width: 1024px)");

  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // Esc closes tablet explorer drawer
  React.useEffect(() => {
    if (isLg || !explorerOpen || !session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExplorerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLg, explorerOpen, session, setExplorerOpen]);

  const showDrawer = !!session && explorerOpen && !isLg;
  const showDocked = !!session && explorerOpen && isLg;

  return (
    <div className="h-dvh flex flex-col overflow-hidden text-[var(--fg)] relative">
      <IdeTopBar
        onToggleExplorer={() => setExplorerOpen(!explorerOpen)}
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
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <IdeDirtyCloseDialog />
      <div
        className={cn(
          "h-7 shrink-0 flex items-center px-3 text-[11px] font-ui border-t border-[var(--chrome-border)] bg-[var(--chrome)] text-[var(--muted)]"
        )}
      >
        IDE · 工程与笔记库隔离 · Java 优先
      </div>
    </div>
  );
}
