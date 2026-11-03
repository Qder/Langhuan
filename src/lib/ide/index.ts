export { languageIdFromPath, type IdeLanguageId } from "./language";
export {
  IDE_RECENT_MAX,
  pushRecentProject,
  removeRecentProject,
  type IdeRecentProjectMeta,
} from "./recentProjects";
export {
  shouldBlockDirtyClose,
  resolveDirtyClose,
  type DirtyCloseChoice,
} from "./dirtyClose";
export { useIdeStore } from "./store";
export { getIdeFsCapability } from "./ideFs";
export {
  listFooterCitations,
  parseIdeCitations,
  resolveIdeCitation,
  planIdeCitationJump,
  ideAncestorDirs,
  buildIdePendingReveal,
  clampIdeLine,
  type IdeCitation,
  type IdeCitationJumpPlan,
  type IdePendingReveal,
} from "./citations";
export {
  assembleExplainUserContent,
  buildExplainFilePayloads,
  buildMockExplainMarkdown,
  collectScannedFileIndex,
  planExplainSelectionRequest,
  javaImportToSuffix,
  listNearbyImports,
  matchUniqueJavaImportPath,
  planNearbyExplainFiles,
  truncateNeighborExplainContent,
  IDE_EXPLAIN_SYSTEM_PROMPT,
} from "./explain";
export {
  compactFolderChain,
  childrenLookupFromMap,
  type CompactFolderChain,
} from "./compactFolders";
export {
  filterQuickOpenPaths,
  planQuickOpenCandidates,
} from "./quickOpen";
export { parseGotoLine, type GotoLineResult } from "./gotoLine";
export {
  findDefinitionLine,
  isGotoDefinitionIdentifier,
  planGotoDefinition,
  wordAtOffset,
  type GotoDefinitionPlan,
} from "./gotoDefinition";
export {
  isBareModL,
  isIdeExplainToggleHotkey,
  isTypingTarget,
} from "./explainHotkey";

export {
  EXPLORER_REVEAL_HIGHLIGHT_MS,
  EXPLORER_REVEAL_GIVE_UP_MS,
  explorerRevealStillWaiting,
  explorerRowSelector,
} from "./explorerReveal";


export {
  formatDocument,
  isFormatDocumentHotkey,
  type FormatDocumentResult,
} from "./formatDocument";
export { IDE_FIND_EVENT, IDE_GOTO_DEF_EVENT } from "./ideEvents";
