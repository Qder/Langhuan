"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
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
import { ShortcutsDialog } from "./ShortcutsDialog";
import { RegisterSW } from "./pwa/RegisterSW";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/storage/constants";
import { matchShortcut, normalizeShortcuts } from "@/lib/shortcuts";

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated);
  const activeId = useStore((s) => s.activeId);
  const setHydrated = useStore((s) => s.setHydrated);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
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
  const createDoc = useStore((s) => s.createDoc);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const toggleDocSplit = useStore((s) => s.toggleDocSplit);
  const closeTab = useStore((s) => s.closeTab);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);

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

  React.useEffect(() => {
    if (!hydrated) {
      const t = window.setTimeout(() => setHydrated(true), 50);
      return () => window.clearTimeout(t);
    }
  }, [hydrated, setHydrated]);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "ink");
  }, [theme]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (matchShortcut(e, shortcuts.commandPalette)) {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (matchShortcut(e, shortcuts.save)) {
        e.preventDefault();
        saveDoc();
        return;
      }
      if (matchShortcut(e, shortcuts.toggleSource)) {
        const active = getActive();
        if (!active) return;
        e.preventDefault();
        const next = viewMode === "source" ? "preview" : "source";
        setViewMode(next);
        setHtmlImmersive(false);
        setStatus(next === "source" ? "已切换到源码" : "已切换到预览");
        return;
      }
      if (matchShortcut(e, shortcuts.newMd) && !typing) {
        e.preventDefault();
        createDoc({ type: "md" });
        return;
      }
      if (matchShortcut(e, shortcuts.dailyNote) && !typing) {
        e.preventDefault();
        openDailyNote();
        return;
      }
      if (matchShortcut(e, shortcuts.toggleDocSplit) && !typing) {
        e.preventDefault();
        toggleDocSplit();
        return;
      }
      if (matchShortcut(e, shortcuts.closeTab) && !typing) {
        const id = useStore.getState().activeId;
        if (!id) return;
        e.preventDefault();
        closeTab(id);
        return;
      }
      if (matchShortcut(e, shortcuts.exportActive) && !typing) {
        e.preventDefault();
        setExportDialogOpen(true);
        return;
      }

      const active = getActive();
      if (active?.type === "html" && !typing) {
        if (e.key === "Escape" && htmlImmersive) {
          e.preventDefault();
          setHtmlImmersive(false);
          setStatus("已退出沉浸模式");
          return;
        }
        if (matchShortcut(e, shortcuts.focusMode)) {
          e.preventDefault();
          const next = !htmlImmersive;
          setHtmlImmersive(next);
          setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
        }
      }
      if (active?.type === "md" && !typing) {
        if (e.key === "Escape" && mdFocusMode) {
          e.preventDefault();
          setMdFocusMode(false);
          setStatus("已退出专注模式");
          return;
        }
        if (matchShortcut(e, shortcuts.focusMode)) {
          e.preventDefault();
          const next = !mdFocusMode;
          setMdFocusMode(next);
          setStatus(next ? "已进入专注模式" : "已退出专注模式");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    createDoc,
    openDailyNote,
    toggleDocSplit,
    closeTab,
    setExportDialogOpen,
  ]);

  if (!hydrated) {
    return (
      <div className="h-dvh flex">
        <div className="hidden md:block w-[280px] border-r border-[var(--border)] p-4 space-y-3">
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
      <ShortcutsDialog />
      <RegisterSW />
    </div>
  );
}
