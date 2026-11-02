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
