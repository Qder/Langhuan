/**
 * Tablet workbench layout helpers.
 * Landscape: note + code side by side. Portrait: one pane visible, both kept
 * mounted so open items and split sizes survive orientation changes.
 * Persistence lives in the existing notes UI store (no new DB).
 */

export const NOTE_CODE_SPLIT_MIN = 0.28;
export const NOTE_CODE_SPLIT_MAX = 0.72;
export const NOTE_CODE_SPLIT_DEFAULT = 0.5;

/** Tablet landscape: wide enough for two panes, and actually landscape. */
export const STUDY_LANDSCAPE_QUERY =
  "(orientation: landscape) and (min-width: 768px)";

export type StudyPaneFocus = "notes" | "code";
export type WorkbenchOrientation = "portrait" | "landscape";

export type PersistedWorkbenchLayout = {
  studySplitEnabled: boolean;
  noteCodeSplitRatio: number;
  studyCodePath: string | null;
  studyPaneFocus: StudyPaneFocus;
  /** Open library note (mirrors `activeId`). */
  noteId: string | null;
  /** Two-note split; unchanged by note+code workbench. */
  secondaryId: string | null;
  docSplitRatio: number;
};

export type WorkbenchView = {
  mode: "exclusive" | "side-by-side" | "stacked";
  notesVisible: boolean;
  codeVisible: boolean;
  /** When study split is on, both shells stay mounted (CSS hide the other). */
  keepBothMounted: boolean;
};

export function clampNoteCodeSplitRatio(r: number): number {
  if (!Number.isFinite(r)) return NOTE_CODE_SPLIT_DEFAULT;
  return Math.min(NOTE_CODE_SPLIT_MAX, Math.max(NOTE_CODE_SPLIT_MIN, r));
}

export function clampDocSplitRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.5;
  return Math.min(0.8, Math.max(0.2, r));
}

export function workbenchView(params: {
  studySplitEnabled: boolean;
  orientation: WorkbenchOrientation;
  focus: StudyPaneFocus;
}): WorkbenchView {
  if (!params.studySplitEnabled) {
    return {
      mode: "exclusive",
      notesVisible: params.focus === "notes",
      codeVisible: params.focus === "code",
      keepBothMounted: false,
    };
  }
  if (params.orientation === "landscape") {
    return {
      mode: "side-by-side",
      notesVisible: true,
      codeVisible: true,
      keepBothMounted: true,
    };
  }
  return {
    mode: "stacked",
    notesVisible: params.focus === "notes",
    codeVisible: params.focus === "code",
    keepBothMounted: true,
  };
}

/**
 * Orientation must not clear open items or split sizes. The same snapshot is
 * what we persist across portrait ↔ landscape and (via the store) reopen.
 */
export function persistWorkbenchAcrossOrientation(
  layout: PersistedWorkbenchLayout,
  _from: WorkbenchOrientation,
  _to: WorkbenchOrientation
): PersistedWorkbenchLayout {
  void _from;
  void _to;
  return {
    studySplitEnabled: !!layout.studySplitEnabled,
    noteCodeSplitRatio: clampNoteCodeSplitRatio(layout.noteCodeSplitRatio),
    studyCodePath: layout.studyCodePath || null,
    studyPaneFocus: layout.studyPaneFocus === "code" ? "code" : "notes",
    noteId: layout.noteId || null,
    secondaryId: layout.secondaryId || null,
    docSplitRatio: clampDocSplitRatio(layout.docSplitRatio),
  };
}

/** Two library notes: stack in portrait (or a narrow notes pane). */
export function dualDocFlexDirection(
  orientation: WorkbenchOrientation,
  containerWidth?: number
): "row" | "column" {
  if (orientation === "portrait") return "column";
  if (containerWidth != null && containerWidth < 640) return "column";
  return "row";
}
