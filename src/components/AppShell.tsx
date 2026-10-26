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

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated);
  const activeId = useStore((s) => s.activeId);
  const setHydrated = useStore((s) => s.setHydrated);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const saveDoc = useStore((s) => s.saveDoc);
  const theme = useStore((s) => s.theme);

  React.useEffect(() => {
    // persist may already hydrate; ensure flag for SSR
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
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDoc();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, saveDoc]);

  if (!hydrated) {
    return (
      <div className="h-dvh flex">
        <div className="hidden md:block w-[300px] border-r border-[var(--border)] p-4 space-y-3">
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

  return (
    <div className="h-dvh flex overflow-hidden text-[var(--fg)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        {activeId && <ReadingProgress />}
        <TopBar />
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeId ? <DocWorkspace /> : <HomeView />}
        </main>
        <StatusBar />
      </div>
      <CommandPalette />
    </div>
  );
}
