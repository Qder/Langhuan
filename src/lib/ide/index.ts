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
  parseIdePathLineToken,
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
  fenceChipLabel,
  locateSnippetInFiles,
  mergeSnippetCorpus,
  overlaySnippetCorpus,
  parseExplainFences,
  snippetInCitedRange,
  type ExplainFence,
  type SnippetFile,
  type SnippetHit,
  type SnippetLocateResult,
} from "./snippetLocate";
export { locateExplainFence, type ReadSnippetFile } from "./snippetJump";
export {
  assembleExplainChatMessages,
  assembleExplainUserContent,
  buildExplainFilePayloads,
  buildMockExplainMarkdown,
  resolveExplainApiMessages,
  selectExplainPriorMessages,
  collectScannedFileIndex,
  planExplainSelectionRequest,
  javaImportToSuffix,
  listNearbyImports,
  matchUniqueJavaImportPath,
  planNearbyExplainFiles,
  planExplainFolderFiles,
  rankExplainFolderPaths,
  truncateNeighborExplainContent,
  IDE_EXPLAIN_SYSTEM_PROMPT,
  IDE_EXPLAIN_MODEL_PRIOR_MAX,
  type ExplainChatMessage,
} from "./explain";
export {
  compactFolderChain,
  childrenLookupFromMap,
  type CompactFolderChain,
} from "./compactFolders";
export {
  IDE_EXPLORER_WIDTH_DEFAULT,
  IDE_EXPLAIN_WIDTH_DEFAULT,
  clampIdeExplorerWidth,
  clampIdeExplainWidth,
} from "./ideSplit";
export {
  filterQuickOpenPaths,
  planQuickOpenCandidates,
} from "./quickOpen";
export { parseGotoLine, type GotoLineResult } from "./gotoLine";
export {
  candidatePathsForMethodSearch,
  findDefinitionLine,
  findDefinitionLineOrNull,
  isGotoDefinitionIdentifier,
  javaImportsOf,
  narrowHitsByJavaImport,
  planGotoDefinition,
  resolveJavaTypeOfIdentifier,
  searchMethodDefinition,
  symbolAtOffset,
  wordAtOffset,
  type GotoDefinitionPlan,
} from "./gotoDefinition";
export {
  findMapperInterfaceForXml,
  findMapperXmlForMethod,
  findMethodDeclarationLine,
  findXmlStatementLine,
  javaTypeFqn,
  looksLikeMapperInterface,
  mapperSimpleName,
  xmlMapperNamespace,
  xmlStatementIdAtOffset,
  type MapperInterfacePlan,
  type MapperXmlPlan,
} from "./mapperNav";
export {
  findExportLineOrNull,
  importSpecAtOffset,
  importSpecsInLine,
  isRelativeSpec,
  planTsImport,
  resolveRelativePath,
  TS_IMPORT_EXTS,
  TS_INDEX_FILES,
  type TsImportPlan,
  type TsImportSpec,
} from "./tsImports";
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
