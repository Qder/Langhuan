"use client";

import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { HomeView } from "./HomeView";
import { DualDocLayout } from "./DocWorkspace";
import { TabBar } from "./TabBar";
import { ReadingProgress } from "./ReadingProgress";
import { MdFocusExitButton } from "./MdFocusExitButton";

/** Existing 藏书阁 chrome: sidebar, reader, two-note DualDocLayout, home. */
export function NotesLibraryShell({
  className,
}: {
  className?: string;
}) {
  const activeId = useStore((s) => s.activeId);
  const getActive = useStore((s) => s.getActive);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const active = getActive();
  const immersiveHtml = htmlImmersive && active?.type === "html";
  const focusMd = mdFocusMode && active?.type === "md";
  const chromeHidden = immersiveHtml || focusMd;

  return (
    <div
      className={cn(
        "h-full flex overflow-hidden text-[var(--fg)] relative",
        focusMd && "md-focus-mode",
        className
      )}
    >
      {!chromeHidden && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {activeId && !chromeHidden && <ReadingProgress />}
        {!chromeHidden && <TopBar />}
        {!chromeHidden && <TabBar />}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeId ? <DualDocLayout /> : <HomeView />}
        </main>
        {focusMd && <MdFocusExitButton />}
        {!chromeHidden && <StatusBar />}
      </div>
    </div>
  );
}
