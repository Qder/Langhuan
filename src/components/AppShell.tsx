"use client";

import * as React from "react";
import { useStore } from "@/lib/store"
import { applyThemeToDocument } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { HomeView } from "./HomeView";
import { DualDocLayout } from "./DocWorkspace";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { ReadingProgress } from "./ReadingProgress";
import { BackupDialog } from "./BackupDialog";
import { FsSyncDialog } from "./FsSyncDialog";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { DirtyNavDialog } from "./DirtyNavDialog";
import { BackupReminder } from "./BackupReminder";
import { KnowledgeGraphDialog } from "./KnowledgeGraphDialog";
import { PropsPanelDialog } from "./PropsPanelDialog";
import { ClipUrlDialog } from "./ClipUrlDialog";
import { TemplateDialog } from "./TemplateDialog";
import { ExportDialog } from "./ExportDialog";
import { QuizReviewDialog } from "./QuizReviewDialog";
import { LinkHealthDialog } from "./LinkHealthDialog";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { FindInFileBar } from "./FindInFileBar";
import { CreateDocDialogHost } from "./CreateDocDialog";
import { openCreateDocDialog } from "@/lib/createDocDialogBus";
import { RegisterSW } from "./pwa/RegisterSW";
import { IdeShell } from "./ide/IdeShell";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/storage/constants";
import { claimShortcut, matchShortcut, normalizeShortcuts } from "@/lib/shortcuts";
import { shouldHandlePreviewUndoShortcut } from "@/lib/previewUndo";

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated);
  const appMode = useStore((s) => s.appMode);
  const activeId = useStore((s) => s.activeId);
  const setHydrated = useStore((s) => s.setHydrated);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const saveDoc = useStore((s) => s.saveDoc);
  const theme = useStore((s) => s.theme);
  const getActive = useStore((s) => s.getActive);
  const setViewMode = useStore((s) => s.setViewMode);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const setHtmlImmersive = useStore((s) => s.setHtmlImmersive);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setStatus = useStore((s) => s.setStatus);
  const viewMode = useStore((s) => s.viewMode);
  const anyDirty = useStore((s) => s.anyDirty);
  const isDirty = useStore((s) => s.isDirty);
  const drafts = useStore((s) => s.drafts);
  const autosaveEnabled = useStore((s) => s.autosaveEnabled);
  const activeIdForSave = useStore((s) => s.activeId);
  const customShortcuts = useStore((s) => s.customShortcuts);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const toggleDocSplit = useStore((s) => s.toggleDocSplit);
  const closeTab = useStore((s) => s.closeTab);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setFindReplaceOpen = useStore((s) => s.setFindReplaceOpen);
  const setFindInFileOpen = useStore((s) => s.setFindInFileOpen);
  const undoPreviewEdit = useStore((s) => s.undoPreviewEdit);
  const redoPreviewEdit = useStore((s) => s.redoPreviewEdit);

  const shortcuts = React.useMemo(
    () => normalizeShortcuts(customShortcuts),
    [customShortcuts]
  );

  // Warn on tab close when there are unsaved drafts
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty, drafts]);

  // Debounced autosave for the active dirty document
  React.useEffect(() => {
    if (!autosaveEnabled || !activeIdForSave) return;
    if (!isDirty(activeIdForSave)) return;
    const t = window.setTimeout(() => {
      if (useStore.getState().isDirty(activeIdForSave)) {
        useStore.getState().saveDoc(activeIdForSave);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [autosaveEnabled, activeIdForSave, drafts, isDirty]);

  // Persist hang fallback — keep short so the shell unlocks; workspace uses
  // paper skeleton when activeId is set but the doc is not loaded yet.
  React.useEffect(() => {
    if (!hydrated) {
      const t = window.setTimeout(() => setHydrated(true), 50);
      return () => window.clearTimeout(t);
    }
  }, [hydrated, setHydrated]);

  React.useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Tablet drawer: restore lightly from session (desktop docked ignores this)
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem("lh.sidebarOpen") === "1") {
        setSidebarOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, [setSidebarOpen]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!useStore.getState().sidebarOpen) return;
      // Only meaningful below lg; harmless if docked chrome also listens.
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      e.preventDefault();
      setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarOpen]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (matchShortcut(e, shortcuts.commandPalette)) {
        claimShortcut(e);
        setCommandOpen(true);
        return;
      }
      // In-file find (Ctrl/Cmd+F). Library search stays on ⌘K.
      // Capture + claim so Chrome/Edge find bar never opens.
      if (matchShortcut(e, shortcuts.search)) {
        claimShortcut(e);
        if (getActive()) setFindInFileOpen(true);
        else setStatus("请先打开一篇文档");
        return;
      }
      if (matchShortcut(e, shortcuts.save)) {
        claimShortcut(e);
        saveDoc();
        return;
      }
      if (matchShortcut(e, shortcuts.toggleSource)) {
        const active = getActive();
        if (!active) return;
        claimShortcut(e);
        const next = viewMode === "source" ? "preview" : "source";
        setViewMode(next);
        setHtmlImmersive(false);
        setStatus(next === "source" ? "已切换到源码" : "已切换到预览");
        return;
      }
      if (matchShortcut(e, shortcuts.newMd) && !typing) {
        claimShortcut(e);
        openCreateDocDialog({ type: "md" });
        return;
      }
      if (matchShortcut(e, shortcuts.dailyNote) && !typing) {
        claimShortcut(e);
        openDailyNote();
        return;
      }
      if (matchShortcut(e, shortcuts.toggleDocSplit) && !typing) {
        claimShortcut(e);
        toggleDocSplit();
        return;
      }
      if (matchShortcut(e, shortcuts.closeTab) && !typing) {
        const id = useStore.getState().activeId;
        if (!id) return;
        claimShortcut(e);
        closeTab(id);
        return;
      }
      if (matchShortcut(e, shortcuts.exportActive) && !typing) {
        claimShortcut(e);
        setExportDialogOpen(true);
        return;
      }
      if (matchShortcut(e, shortcuts.findReplace) && !typing) {
        claimShortcut(e);
        setFindReplaceOpen(true);
        return;
      }

      // Preview-edit document undo/redo — never steal CodeMirror history.
      if (
        matchShortcut(e, shortcuts.previewUndo) &&
        shouldHandlePreviewUndoShortcut(e.target, typing)
      ) {
        if (undoPreviewEdit()) {
          claimShortcut(e);
        }
        return;
      }
      if (
        (matchShortcut(e, shortcuts.previewRedo) ||
          matchShortcut(e, "mod+y")) &&
        shouldHandlePreviewUndoShortcut(e.target, typing)
      ) {
        if (redoPreviewEdit()) {
          claimShortcut(e);
        }
        return;
      }

      const active = getActive();
      if (active?.type === "html" && !typing) {
        if (e.key === "Escape" && htmlImmersive) {
          claimShortcut(e);
          setHtmlImmersive(false);
          setStatus("已退出沉浸模式");
          return;
        }
        if (matchShortcut(e, shortcuts.focusMode)) {
          claimShortcut(e);
          const next = !htmlImmersive;
          setHtmlImmersive(next);
          setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
        }
      }
      if (active?.type === "md" && !typing) {
        if (e.key === "Escape" && mdFocusMode) {
          claimShortcut(e);
          setMdFocusMode(false);
          setStatus("已退出专注模式");
          return;
        }
        if (matchShortcut(e, shortcuts.focusMode)) {
          claimShortcut(e);
          const next = !mdFocusMode;
          setMdFocusMode(next);
          setStatus(next ? "已进入专注模式" : "已退出专注模式");
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    setCommandOpen,
    saveDoc,
    getActive,
    setViewMode,
    htmlImmersive,
    setHtmlImmersive,
    mdFocusMode,
    setMdFocusMode,
    setStatus,
    viewMode,
    shortcuts,
    openDailyNote,
    toggleDocSplit,
    closeTab,
    setExportDialogOpen,
    setFindReplaceOpen,
    setFindInFileOpen,
    undoPreviewEdit,
    redoPreviewEdit,
  ]);

  if (!hydrated) {
    return (
      <div className="h-dvh flex">
        <div className="hidden lg:block w-[280px] border-r border-[var(--border)] p-4 space-y-3">
          <div className="skeleton h-10" />
          <div className="skeleton h-9" />
          <div className="skeleton h-9" />
          <div className="skeleton h-40" />
        </div>
        <div className="flex-1 p-8 space-y-4">
          <div className="skeleton h-8 w-1/3" />
          <div className="skeleton h-40" />
          <div className="skeleton h-24" />
        </div>
      </div>
    );
  }

  if (appMode === "ide") {
    return <IdeShell />;
  }

  const active = getActive();
  const immersiveHtml = htmlImmersive && active?.type === "html";
  const focusMd = mdFocusMode && active?.type === "md";
  const chromeHidden = immersiveHtml || focusMd;

  return (
    <div className={cn("h-dvh flex overflow-hidden text-[var(--fg)] relative", focusMd && "md-focus-mode")}>
      {!chromeHidden && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {activeId && !chromeHidden && <ReadingProgress />}
        {!chromeHidden && <TopBar />}
        {!chromeHidden && <TabBar />}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeId ? <DualDocLayout /> : <HomeView />}
        </main>
        {!chromeHidden && <StatusBar />}
      </div>
      <CommandPalette />
      <BackupDialog />
      <FsSyncDialog />
      <VersionHistoryDialog />
      <DirtyNavDialog />
      <BackupReminder />
      <KnowledgeGraphDialog />
      <PropsPanelDialog />
      <ClipUrlDialog />
      <TemplateDialog />
      <ExportDialog />
      <QuizReviewDialog />
      <LinkHealthDialog />
      <FindReplaceDialog />
      <ShortcutsDialog />
      <SettingsDialog />
      <FindInFileBar />
      <CreateDocDialogHost />
      <RegisterSW />
    </div>
  );
}
