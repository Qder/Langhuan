"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import { useStore } from "@/lib/store";
import { IdeImportReport } from "./IdeImportReport";
import { ReleaseNotes } from "../ReleaseNotes";
import { IdeTopBar } from "./IdeTopBar";
import { IdeExplorer } from "./IdeExplorer";
import { IdeTabBar } from "./IdeTabBar";
import { IdeEditor } from "./IdeEditor";
import { IdeWelcome } from "./IdeWelcome";
import { IdePendingLinkBanner } from "./IdePendingLinkBanner";
import { IdeDirtyCloseDialog } from "./IdeDirtyCloseDialog";
import { IdeExplainPanel } from "./IdeExplainPanel";
import { IdeQuickOpen } from "./IdeQuickOpen";
import { IdeGotoLine } from "./IdeGotoLine";
import { IdeWorkspaceSearch } from "./IdeWorkspaceSearch";
import { IdeOutlineRail } from "./IdeOutlineRail";
import { IdeRecentFiles } from "./IdeRecentFiles";
import { CommandPalette } from "../CommandPalette";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { isIdeExplainToggleHotkey } from "@/lib/ide/explainHotkey";
import {
  formatDocument,
  isFormatDocumentHotkey,
} from "@/lib/ide/formatDocument";
import { IDE_FIND_EVENT, IDE_GOTO_DEF_EVENT } from "@/lib/ide/ideEvents";
import { claimShortcut } from "@/lib/shortcuts";
import {
  IDE_WIDE_QUERY,
  IDE_EXPLAIN_DOCK_QUERY,
  isExplorerLayerVisible,
  toggleExplorerLayers,
} from "@/lib/ide/panelLayers";
import { cn } from "@/lib/utils";
import { ResizeGutter } from "../ui/ResizeGutter";
import {
  IDE_EXPLAIN_WIDTH_DEFAULT,
  IDE_EXPLAIN_WIDTH_MAX,
  IDE_EXPLAIN_WIDTH_MIN,
  IDE_EXPLORER_WIDTH_DEFAULT,
  IDE_EXPLORER_WIDTH_MAX,
  IDE_EXPLORER_WIDTH_MIN,
  clampIdeExplainWidth,
  clampIdeExplorerWidth,
} from "@/lib/ide/ideSplit";

export function IdeShell() {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const explorerOpen = useIdeStore((s) => s.explorerOpen);
  const setExplorerOpen = useIdeStore((s) => s.setExplorerOpen);
  const explorerWidth = useIdeStore((s) => s.explorerWidth);
  const setExplorerWidth = useIdeStore((s) => s.setExplorerWidth);
  const explainOpen = useIdeStore((s) => s.explainOpen);
  const setExplainOpen = useIdeStore((s) => s.setExplainOpen);
  const explainWidth = useIdeStore((s) => s.explainWidth);
  const setExplainWidth = useIdeStore((s) => s.setExplainWidth);
  const splitRef = React.useRef<HTMLDivElement>(null);
  const anyDirty = useIdeStore((s) => s.anyDirty);
  const status = useIdeStore((s) => s.status);
  const tabs = useIdeStore((s) => s.tabs);
  const setStatus = useIdeStore((s) => s.setStatus);
  const saveFile = useIdeStore((s) => s.saveFile);
  const requestCloseTab = useIdeStore((s) => s.requestCloseTab);
  const setDraft = useIdeStore((s) => s.setDraft);
  const outlineOpen = useIdeStore((s) => s.outlineOpen);
  const setOutlineOpen = useIdeStore((s) => s.setOutlineOpen);
  const toggleOutlineOpen = useIdeStore((s) => s.toggleOutlineOpen);
  const isLg = useMediaQuery(IDE_WIDE_QUERY);
  const explainDocked = useMediaQuery(IDE_EXPLAIN_DOCK_QUERY);
  const isXl = useMediaQuery("(min-width: 1280px)");
  const [explainMax, setExplainMax] = React.useState(IDE_EXPLAIN_WIDTH_MAX);
  // Refit persisted desktop sizes when rotating a tablet or shrinking a window.
  React.useEffect(() => {
    const fit = () => {
      const width = splitRef.current?.getBoundingClientRect().width ?? 0;
      if (!width || !explainDocked) return;
      const state = useIdeStore.getState();
      const tree = isLg && state.explorerOpen;
      const nextExplain = clampIdeExplainWidth(state.explainWidth, {
        containerWidth: width, explorerOpen: tree, explorerWidth: IDE_EXPLORER_WIDTH_MIN,
      });
      const nextTree = clampIdeExplorerWidth(state.explorerWidth, {
        containerWidth: width, explainOpen: state.explainOpen, explainWidth: nextExplain,
      });
      if (state.explainOpen && nextExplain !== state.explainWidth) state.setExplainWidth(nextExplain);
      if (tree && nextTree !== state.explorerWidth) state.setExplorerWidth(nextTree);
      setExplainMax(clampIdeExplainWidth(IDE_EXPLAIN_WIDTH_MAX, {
        containerWidth: width, explorerOpen: tree, explorerWidth: nextTree,
      }));
    };
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", fit); };
  }, [isLg, explainDocked, explorerOpen, explainOpen, explorerWidth]);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [gotoLineOpen, setGotoLineOpen] = React.useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = React.useState(false);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const openFolder = useIdeStore((s) => s.openFolder);
  const workspaceSearchEvent = React.useCallback(
    () => setWorkspaceSearchOpen(true),
    []
  );

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

  // Tablet: one modal drawer at a time (explorer ↔ explain).
  // This used to be a sync setState effect on [explainOpen, explorerOpen], which
  // React Compiler flags (set-state-in-effect) and which also mutated state on
  // any render where the two booleans happened to be true together. The rule
  // now lives in the store — applied when a layer is actually opened, plus one
  // reconcile on rehydrate / project open — so this component only renders.

  const openExplorer = React.useCallback(() => {
    setExplorerOpen(true);
  }, [setExplorerOpen]);

  const toggleExplorer = React.useCallback(() => {
    const { explorerOpen: open, explainOpen: explain } = useIdeStore.getState();
    const next = toggleExplorerLayers(
      { explorerOpen: open, explainOpen: explain },
      !isLg
    );
    setExplorerOpen(next.explorerOpen ?? false);
  }, [isLg, setExplorerOpen]);

  const toggleExplain = React.useCallback(() => {
    const next = !useIdeStore.getState().explainOpen;
    setExplainOpen(next);
  }, [setExplainOpen]);

  // Central IDE shortcut claim (capture) so browser never steals Mod+F/P/S/W/B/G etc.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if (isIdeExplainToggleHotkey(e)) {
        claimShortcut(e);
        toggleExplain();
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

      // Mod+K command palette (same palette as 藏书阁, with IDE commands added)
      if (key === "k" && !e.shiftKey && !e.altKey) {
        claimShortcut(e);
        setCommandOpen(true);
        return;
      }

      // Mod+Shift+F workspace text search (read-only)
      if (key === "f" && e.shiftKey && !e.altKey) {
        claimShortcut(e);
        if (!session) {
          setStatus("先打开文件夹");
          return;
        }
        setWorkspaceSearchOpen(true);
        return;
      }

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
        toggleExplorer();
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    session,
    activePath,
    setStatus,
    toggleExplain,
    toggleExplorer,
    setDraft,
    saveFile,
    requestCloseTab,
    setCommandOpen,
  ]);

  const showDrawer =
    !!session && !isLg && isExplorerLayerVisible({ explorerOpen, explainOpen }, true);
  const showDocked = !!session && explorerOpen && isLg;
  const activeTab = tabs.find((t) => t.path === activePath) ?? null;

  const onExplorerDelta = React.useCallback(
    (deltaPx: number) => {
      const container = splitRef.current?.getBoundingClientRect().width ?? 0;
      const s = useIdeStore.getState();
      setExplorerWidth(
        clampIdeExplorerWidth(s.explorerWidth + deltaPx, {
          containerWidth: container,
          explainOpen: explainDocked && s.explainOpen,
          explainWidth: s.explainWidth,
        })
      );
    },
    [explainDocked, setExplorerWidth]
  );

  const onExplainDelta = React.useCallback(
    (deltaPx: number) => {
      const container = splitRef.current?.getBoundingClientRect().width ?? 0;
      const s = useIdeStore.getState();
      setExplainWidth(
        clampIdeExplainWidth(s.explainWidth - deltaPx, {
          containerWidth: container,
          explorerOpen: isLg && s.explorerOpen,
          explorerWidth: s.explorerWidth,
        })
      );
    },
    [isLg, setExplainWidth]
  );

  const explorerGutter = (
    <ResizeGutter
      axis="horizontal"
      label="调整文件树宽度"
      value={explorerWidth}
      min={IDE_EXPLORER_WIDTH_MIN}
      max={IDE_EXPLORER_WIDTH_MAX}
      onDelta={onExplorerDelta}
      onReset={() => setExplorerWidth(IDE_EXPLORER_WIDTH_DEFAULT)}
    />
  );

  return (
    <div className="h-dvh flex flex-col overflow-hidden text-[var(--fg)] relative">
      <IdeTopBar
        onToggleExplorer={toggleExplorer}
        onToggleExplain={toggleExplain}
        onOpenWorkspaceSearch={() => setWorkspaceSearchOpen(true)}
        explainOpen={explainOpen}
        outlineOpen={outlineOpen}
        onToggleOutline={() => toggleOutlineOpen()}
        canToggleOutline={!!activePath}
      />
      <div ref={splitRef} className="flex-1 min-h-0 flex relative">
        {showDocked && (
          <>
            <IdeExplorer />
            {explorerGutter}
          </>
        )}

        {/* Tablet drawer explorer */}
        {showDrawer && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-30 bg-black/35"
              aria-label="关闭文件面板"
              onClick={() => setExplorerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-40 shadow-2xl animate-enter flex">
              <IdeExplorer />
              {explorerGutter}
            </div>
          </>
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
          {!session ? (
            <IdeWelcome />
          ) : (
            <>
              <IdeTabBar />
              <div className="relative flex-1 min-h-0 flex">
                <div className="flex-1 min-w-0">
                  {activePath ? (
                    <IdeEditor key={activePath} path={activePath} />
                  ) : (
                    <div className="h-full overflow-y-auto">
                      <div className="mx-auto max-w-md px-6 py-12 flex flex-col items-center gap-2 text-sm text-[var(--muted)] font-ui text-center">
                        <p>打开一个文件开始读码。</p>
                        <p>选中后讲解；点回复里的代码块可跳回源码。</p>
                        {!isLg && !showDrawer && (
                          <button
                            type="button"
                            className="mt-2 text-[var(--accent)] hover:underline"
                            onClick={openExplorer}
                          >
                            打开文件
                          </button>
                        )}
                        <IdeRecentFiles
                          className="mt-6 w-full text-left"
                          currentSessionId={session?.id}
                        />
                        <div className="mt-6 w-full text-left">
                          <IdePendingLinkBanner />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {outlineOpen && activePath && (
                  <IdeOutlineRail
                    path={activePath}
                    draft={activeTab?.draft ?? ""}
                    onCollapse={() => setOutlineOpen(false)}
                    variant={isXl ? "docked" : "overlay"}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {explainOpen && explainDocked && (
          <ResizeGutter
            axis="horizontal"
            label="调整讲解面板宽度"
            value={explainWidth}
            min={IDE_EXPLAIN_WIDTH_MIN}
            max={explainMax}
            onValue={(value) => onExplainDelta(useIdeStore.getState().explainWidth - value)}
            onDelta={onExplainDelta}
            onReset={() => setExplainWidth(IDE_EXPLAIN_WIDTH_DEFAULT)}
          />
        )}
        {explainOpen && (
          <IdeExplainPanel onClose={() => setExplainOpen(false)} />
        )}
      </div>
      <IdeQuickOpen open={quickOpen} onClose={() => setQuickOpen(false)} />
      <IdeGotoLine open={gotoLineOpen} onClose={() => setGotoLineOpen(false)} />
      <IdeWorkspaceSearch
        open={workspaceSearchOpen}
        onClose={() => setWorkspaceSearchOpen(false)}
      />
      <CommandPalette
        ide={{
          onQuickOpen: () => {
            if (!useIdeStore.getState().session) {
              setStatus("先打开文件夹");
            }
            setQuickOpen(true);
          },
          onWorkspaceSearch: workspaceSearchEvent,
          onToggleExplain: toggleExplain,
          onOpenFolder: () => void openFolder(),
        }}
      />
      <IdeDirtyCloseDialog />
      <div
        className={cn(
          "min-h-7 max-lg:min-h-6 shrink-0 flex items-center px-3 py-0.5 text-[11px] max-lg:text-[10px] font-ui border-t border-[var(--chrome-border)] bg-[var(--chrome)] text-[var(--muted)]"
        )}
      >
        <span
          className="flex-1 min-w-0 break-all leading-tight"
          title={status || undefined}
        >
          {status || "读码 · 讲解"}
        </span>
        <IdeImportReport />
        <ReleaseNotes />
      </div>
    </div>
  );
}
