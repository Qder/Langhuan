"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { useIdeStore } from "@/lib/ide/store";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { ResizeGutter } from "./ui/ResizeGutter";
import { NotesLibraryShell } from "./NotesLibraryShell";
import { IdeShell } from "./ide/IdeShell";
import {
  NOTE_CODE_SPLIT_DEFAULT,
  NOTE_CODE_SPLIT_MAX,
  NOTE_CODE_SPLIT_MIN,
  STUDY_LANDSCAPE_QUERY,
  workbenchView,
  type WorkbenchOrientation,
} from "@/lib/workbenchLayout";

/**
 * Tablet workbench: reuses the existing note reader and 读码 viewer.
 * Landscape places them side by side; portrait keeps both mounted and shows
 * the focused pane so rotation does not lose the open note, file, or ratio.
 */
export function NoteCodeWorkbench() {
  const ratio = useStore((s) => s.noteCodeSplitRatio);
  const setRatio = useStore((s) => s.setNoteCodeSplitRatio);
  const focus = useStore((s) => s.studyPaneFocus);
  const setFocus = useStore((s) => s.setStudyPaneFocus);
  const studyCodePath = useStore((s) => s.studyCodePath);
  const setStudyCodePath = useStore((s) => s.setStudyCodePath);
  const landscape = useMediaQuery(STUDY_LANDSCAPE_QUERY);
  const orientation: WorkbenchOrientation = landscape ? "landscape" : "portrait";
  const view = workbenchView({
    studySplitEnabled: true,
    orientation,
    focus,
  });

  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const openFile = useIdeStore((s) => s.openFile);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const restoredRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (activePath) setStudyCodePath(activePath);
  }, [activePath, setStudyCodePath]);

  React.useEffect(() => {
    if (!session || activePath || !studyCodePath) return;
    if (restoredRef.current === `${session.id}:${studyCodePath}`) return;
    restoredRef.current = `${session.id}:${studyCodePath}`;
    void openFile(studyCodePath);
  }, [session, activePath, studyCodePath, openFile]);

  const onDelta = React.useCallback(
    (deltaPx: number) => {
      const el = containerRef.current;
      if (!el) return;
      const total = el.getBoundingClientRect().width;
      if (total <= 0) return;
      setRatio(useStore.getState().noteCodeSplitRatio + deltaPx / total);
    },
    [setRatio]
  );

  const notesPane = (
    <div
      data-workbench-pane="notes"
      className={cn(
        "min-h-0 min-w-0 overflow-hidden",
        view.mode === "stacked" && "absolute inset-0",
        view.mode === "stacked" && !view.notesVisible && "invisible pointer-events-none"
      )}
      style={
        view.mode === "side-by-side"
          ? { flex: `${ratio} 1 0%` }
          : undefined
      }
      aria-hidden={view.mode === "stacked" && !view.notesVisible}
    >
      <NotesLibraryShell />
    </div>
  );

  const codePane = (
    <div
      data-workbench-pane="code"
      className={cn(
        "min-h-0 min-w-0 overflow-hidden",
        view.mode === "stacked" && "absolute inset-0",
        view.mode === "stacked" && !view.codeVisible && "invisible pointer-events-none"
      )}
      style={
        view.mode === "side-by-side"
          ? { flex: `${1 - ratio} 1 0%` }
          : undefined
      }
      aria-hidden={view.mode === "stacked" && !view.codeVisible}
    >
      <IdeShell embedded />
    </div>
  );

  return (
    <div className="h-dvh flex flex-col overflow-hidden text-[var(--fg)]">
      {view.mode === "stacked" && (
        <div
          role="tablist"
          aria-label="工作台分面"
          className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--chrome-border)] bg-[var(--chrome)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={focus === "notes"}
            className={cn(
              "flex-1 min-h-11 rounded-xl text-sm font-ui",
              focus === "notes"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:bg-[var(--hover)]"
            )}
            onClick={() => setFocus("notes")}
          >
            笔记
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={focus === "code"}
            className={cn(
              "flex-1 min-h-11 rounded-xl text-sm font-ui",
              focus === "code"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:bg-[var(--hover)]"
            )}
            onClick={() => setFocus("code")}
          >
            源码
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        data-workbench-layout={view.mode}
        className={cn(
          "flex-1 min-h-0",
          view.mode === "side-by-side" ? "flex flex-row" : "relative"
        )}
      >
        {notesPane}
        {view.mode === "side-by-side" && (
          <ResizeGutter
            className="w-2 cursor-col-resize self-stretch"
            axis="horizontal"
            label="调整笔记与源码分栏"
            value={Math.round(ratio * 100)}
            min={Math.round(NOTE_CODE_SPLIT_MIN * 100)}
            max={Math.round(NOTE_CODE_SPLIT_MAX * 100)}
            onDelta={onDelta}
            onReset={() => setRatio(NOTE_CODE_SPLIT_DEFAULT)}
          />
        )}
        {codePane}
      </div>
    </div>
  );
}
