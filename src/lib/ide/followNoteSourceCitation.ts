/**
 * Open the Step 5 workbench (or focus the code pane) and jump to a citation.
 */
"use client";

import { useStore } from "@/lib/store";
import { useIdeStore } from "./store";
import { listIdeDir, readIdeFile } from "./ideFs";
import {
  jumpMissMessage,
  resolveNoteSourceJump,
} from "./noteSourceJump";
import type { NoteSourceCitation } from "./noteSourceCitation";
import type { IdeLinkTarget } from "./ideLink";

export function openWorkbenchCodePane(): void {
  const notes = useStore.getState();
  if (!notes.studySplitEnabled) notes.setStudySplitEnabled(true);
  notes.setStudyPaneFocus("code");
}

export function citationToIdeLink(c: NoteSourceCitation): IdeLinkTarget {
  const target: IdeLinkTarget = {
    path: c.path,
    line: c.fromLine,
  };
  if (c.toLine > c.fromLine) target.endLine = c.toLine;
  if (c.projectId) target.projectId = c.projectId;
  if (c.snapshot) target.snapshot = c.snapshot;
  return target;
}

export async function followNoteSourceCitation(
  citation: NoteSourceCitation
): Promise<{ jumped: boolean; showedSnapshot: boolean }> {
  openWorkbenchCodePane();
  const ide = useIdeStore.getState();
  const session = ide.session;

  if (!session) {
    useIdeStore.setState({ pendingIdeLink: citationToIdeLink(citation) });
    const msg = "先打开包含该引用的工程，打开后会按快照跳到对应行";
    ide.setStatus(msg);
    useStore.getState().setStatus(msg);
    return { jumped: false, showedSnapshot: true };
  }

  const readFile = async (relPath: string) => {
    try {
      return await readIdeFile(session, relPath);
    } catch {
      return null;
    }
  };

  const result = await resolveNoteSourceJump({
    citation,
    readFile,
    searchProject: {
      listDir: (dir) => listIdeDir(session, dir),
      readFile,
    },
  });

  if (result.ok) {
    const ok = await useIdeStore.getState().openFile(result.path, {
      line: result.fromLine,
      endLine: result.toLine,
    });
    if (!ok) {
      const msg = jumpMissMessage("no-file");
      useIdeStore.getState().setStatus(msg);
      useStore.getState().setStatus(msg);
      return { jumped: false, showedSnapshot: true };
    }
    useIdeStore.getState().clearPendingIdeLink();
    const msg = result.relocated
      ? `源码已移动，已跳到 ${result.path}:${result.fromLine}${
          result.toLine > result.fromLine ? `-${result.toLine}` : ""
        }`
      : `已跳到 ${result.path}:${result.fromLine}${
          result.toLine > result.fromLine ? `-${result.toLine}` : ""
        }`;
    useIdeStore.getState().setStatus(msg);
    useStore.getState().setStatus(msg);
    return { jumped: true, showedSnapshot: false };
  }

  const msg = jumpMissMessage(result.reason);
  useIdeStore.getState().setStatus(msg);
  useStore.getState().setStatus(msg);
  // Keep the user on the note so the saved snapshot stays visible.
  useStore.getState().setStudyPaneFocus("notes");
  return { jumped: false, showedSnapshot: true };
}
