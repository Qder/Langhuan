"use client";

import { CommandPalette } from "./CommandPalette";
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
import { RegisterSW } from "./pwa/RegisterSW";

/** Dialogs that belong to the notes library shell (not 读码). */
export function LibraryOverlays({
  includeCommandPalette = true,
}: {
  includeCommandPalette?: boolean;
}) {
  return (
    <>
      {includeCommandPalette && <CommandPalette />}
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
    </>
  );
}
