"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { HomeView } from "./HomeView";
import { DocWorkspace } from "./DocWorkspace";
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
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/storage/constants";

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
  const setStatus = useStore((s) => s.setStatus);
  const viewMode = useStore((s) => s.viewMode);
  const anyDirty = useStore((s) => s.anyDirty);
  const isDirty = useStore((s) => s.isDirty);
  const drafts = useStore((s) => s.drafts);
  const autosaveEnabled = useStore((s) => s.autosaveEnabled);
  const activeIdForSave = useStore((s) => s.activeId);

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
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDoc();
        return;
      }
      if (meta && e.key.toLowerCase() === "e") {
        const active = getActive();
        if (!active) return;
        e.preventDefault();
        const next = viewMode === "source" ? "preview" : "source";
        setViewMode(next);
        setHtmlImmersive(false);
        setStatus(next === "source" ? "已切换到源码" : "已切换到预览");
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
        if ((e.key === "f" || e.key === "F") && !meta) {
          e.preventDefault();
          const next = !htmlImmersive;
          setHtmlImmersive(next);
          setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
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
    setStatus,
    viewMode,
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

  return (
    <div className="h-dvh flex overflow-hidden text-[var(--fg)] relative">
      {!immersiveHtml && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {activeId && !immersiveHtml && <ReadingProgress />}
        {!immersiveHtml && <TopBar />}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeId ? <DocWorkspace /> : <HomeView />}
        </main>
        {!immersiveHtml && <StatusBar />}
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
    </div>
  );
}
