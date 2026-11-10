import { describe, expect, it } from "vitest";
import {
  clampNoteCodeSplitRatio,
  dualDocFlexDirection,
  persistWorkbenchAcrossOrientation,
  workbenchView,
  type PersistedWorkbenchLayout,
} from "./workbenchLayout";

const layout: PersistedWorkbenchLayout = {
  studySplitEnabled: true,
  noteCodeSplitRatio: 0.42,
  studyCodePath: "src/main.rs",
  studyPaneFocus: "code",
  noteId: "note-1",
  secondaryId: "note-2",
  docSplitRatio: 0.63,
};

describe("workbenchView", () => {
  it("shows note and code side by side in landscape when study split is on", () => {
    const view = workbenchView({
      studySplitEnabled: true,
      orientation: "landscape",
      focus: "notes",
    });
    expect(view).toEqual({
      mode: "side-by-side",
      notesVisible: true,
      codeVisible: true,
      keepBothMounted: true,
    });
  });

  it("in portrait keeps both mounted but only the focused pane visible", () => {
    expect(
      workbenchView({
        studySplitEnabled: true,
        orientation: "portrait",
        focus: "notes",
      })
    ).toMatchObject({
      mode: "stacked",
      notesVisible: true,
      codeVisible: false,
      keepBothMounted: true,
    });
    expect(
      workbenchView({
        studySplitEnabled: true,
        orientation: "portrait",
        focus: "code",
      })
    ).toMatchObject({
      notesVisible: false,
      codeVisible: true,
      keepBothMounted: true,
    });
  });
});

describe("persistWorkbenchAcrossOrientation", () => {
  it("keeps note, source file, focus, and split sizes when rotating", () => {
    const after = persistWorkbenchAcrossOrientation(layout, "landscape", "portrait");
    expect(after).toEqual(layout);
    const back = persistWorkbenchAcrossOrientation(after, "portrait", "landscape");
    expect(back).toEqual(layout);
  });

  it("clamps a wild ratio but still keeps the open items", () => {
    const after = persistWorkbenchAcrossOrientation(
      { ...layout, noteCodeSplitRatio: 2, docSplitRatio: -1 },
      "landscape",
      "portrait"
    );
    expect(after.noteId).toBe("note-1");
    expect(after.studyCodePath).toBe("src/main.rs");
    expect(after.secondaryId).toBe("note-2");
    expect(after.noteCodeSplitRatio).toBe(clampNoteCodeSplitRatio(2));
    expect(after.docSplitRatio).toBeGreaterThanOrEqual(0.2);
  });
});

describe("dualDocFlexDirection", () => {
  it("stacks two library notes in portrait and stays row in wide landscape", () => {
    expect(dualDocFlexDirection("portrait")).toBe("column");
    expect(dualDocFlexDirection("landscape", 900)).toBe("row");
    expect(dualDocFlexDirection("landscape", 500)).toBe("column");
  });
});
