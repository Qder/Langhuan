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
import { isIdeExplainToggleHotkey } from "@/lib/ide/explainHotkey";
import {
  formatDocument,
  isFormatDocumentHotkey,
} from "@/lib/ide/formatDocument";
import { IDE_FIND_EVENT, IDE_GOTO_DEF_EVENT } from "@/lib/ide/ideEvents";
import { claimShortcut } from "@/lib/shortcuts";
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
  const saveFile = useIdeStore((s) => s.saveFile);
  const requestCloseTab = useIdeStore((s) => s.requestCloseTab);
  const setDraft = useIdeStore((s) => s.setDraft);
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

  // Central IDE shortcut claim (capture) so browser never steals Mod+F/P/S/W/B/G etc.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if (isIdeExplainToggleHotkey(e)) {
        claimShortcut(e);
        toggleExplainOpen();
        return;
      }

      if (isFormatDocumentHotkey(e)) {
        claimShortcut(e);
        const path = useIdeStore.getState().activePath;
        if (!path) {
          setStatus("请先打开一个文件");
          return;
        }
        const tab = useIdeStore.getState().tabs.find((t) => t.path === path);
        const draft = tab?.draft ?? "";
        const result = formatDocument(path, draft);
        if (!result.ok) {
          setStatus(`格式化失败：${result.reason}`);
          return;
        }
        if (!result.changed) {
          setStatus("已是规范格式");
          return;
        }
        setDraft(path, result.text);
        setStatus("已格式化文档");
        return;
      }

      // F12 → go to definition (IdeEditor resolves word at cursor)
      if (e.key === "F12" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        claimShortcut(e);
        if (!activePath) {
          setStatus("请先打开一个文件");
          return;
        }
        window.dispatchEvent(new CustomEvent(IDE_GOTO_DEF_EVENT));
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Mod+P quick open
      if (key === "p" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!session) setStatus("先打开文件夹");
        setQuickOpen(true);
        return;
      }

      // Mod+G go to line
      if (key === "g" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!activePath) {
          setStatus("请先打开一个文件");
          return;
        }
        setGotoLineOpen(true);
        return;
      }

      // Mod+F find in editor (CM search panel) — claim so browser find never opens
      if (key === "f" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!activePath) {
          setStatus("请先打开一个文件");
          return;
        }
        window.dispatchEvent(new CustomEvent(IDE_FIND_EVENT));
        return;
      }

      // Mod+S save
      if (key === "s" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!activePath) {
          setStatus("请先打开一个文件");
          return;
        }
        void saveFile(activePath);
        return;
      }

      // Mod+W close tab
      if (key === "w" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!activePath) return;
        requestCloseTab(activePath);
        return;
      }

      // Mod+B toggle explorer
      if (key === "b" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!session) {
          setStatus("先打开文件夹");
          return;
        }
        setExplorerOpen(!useIdeStore.getState().explorerOpen);
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    session,
    activePath,
    setStatus,
    toggleExplainOpen,
    setDraft,
    saveFile,
    requestCloseTab,
    setExplorerOpen,
  ]);

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
                    ⌘/Ctrl+P 快速打开；⌘/Ctrl+G 转到行；F12 转到定义；Shift+Alt+F
                    格式化；⌘/Ctrl+Shift+L 讲解。
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
          {status ||
            "IDE · ⌘/Ctrl+P 打开 · F12 定义 · Shift+Alt+F 格式化 · ⌘/Ctrl+Shift+L 讲解"}
        </span>
      </div>
    </div>
  );
}
