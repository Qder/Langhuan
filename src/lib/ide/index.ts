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
  buildExplainFilePayloads,
  buildMockExplainMarkdown,
  IDE_EXPLAIN_SYSTEM_PROMPT,
} from "./explain";
export {
  compactFolderChain,
  childrenLookupFromMap,
  type CompactFolderChain,
} from "./compactFolders";
