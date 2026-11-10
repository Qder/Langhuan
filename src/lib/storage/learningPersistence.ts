"use client";
import { ensureBackupAdoption } from "./backupAdoption";
import type { LanghuanState } from "../store/types";
import { readScrollMemoryMap, hydrateScrollMemoryMap, configureScrollMemoryLibrary, flushScrollMemoryLibrary } from "../scrollMemory";
import { LEARNING_PATHS } from "./learningData";
import { migrateLearningData } from "./learningMigration";
import { libraryLearningIO, persistLearningFile, reportLearningError, setLearningReadBlocked, isLearningReadBlocked, waitForLearningWrites } from "./learningIO";
import { migrateAllVersions } from "./versions";
type Get = () => LanghuanState;
type Set = (value: Partial<LanghuanState>) => void;
let active = false;
let hydration: Promise<void> | undefined;
export function hydrateLearningState(get: Get, set: Set): Promise<void> {
  if (!hydration) hydration = hydrateLearningStateUnlocked(get, set).finally(() => { hydration = undefined; });
  return hydration;
}
async function hydrateLearningStateUnlocked(get: Get, set: Set): Promise<void> {
  active = false;
  await waitForLearningWrites();
  try {
    await ensureBackupAdoption(get, set);
    const result = await migrateLearningData(() => ({ annotations: get().annotations, savedSearches: get().savedSearches, quizDocs: get().quizDocs, progress: readScrollMemoryMap() }), libraryLearningIO, (merged) => {
      set({ annotations: merged.annotations, savedSearches: merged.savedSearches, quizDocs: merged.quizDocs });
      hydrateScrollMemoryMap(merged.progress);
    });
    for (const path of Object.values(LEARNING_PATHS)) setLearningReadBlocked(path, result.blocked.includes(path));
    await migrateAllVersions([...get().documents.map((d) => d.id), ...get().trash.map((t) => t.doc.id)]);
    if (result.errors.length) reportLearningError("迁移", result.errors.join("；"));
  } catch (e) {
    for (const path of Object.values(LEARNING_PATHS)) setLearningReadBlocked(path, true);
    reportLearningError("迁移", e);
  }
  finally {
    active = true;
    // Edits during hydration stay in old stores; commit the latest, not an early snapshot.
    const state = get();
    const write = (path: string, value: Parameters<typeof persistLearningFile>[1]) => isLearningReadBlocked(path) ? Promise.resolve() : persistLearningFile(path, value);
    await Promise.all([
      write(LEARNING_PATHS.annotations, { format: "langhuan-annotations", version: 1, annotations: state.annotations }),
      write(LEARNING_PATHS.searches, { format: "langhuan-saved-searches", version: 1, searches: state.savedSearches }),
      write(LEARNING_PATHS.quiz, { format: "langhuan-quiz", version: 1, updatedAt: Date.now(), docs: state.quizDocs }),
      write(LEARNING_PATHS.progress, { format: "langhuan-reading-progress", version: 1, progress: readScrollMemoryMap() }),
    ].map((write) => write.catch(() => {})));
  }
}
/** Subscribe once. IDB partialize remains unchanged as the rollback copy. */
export function installLearningPersistence(store: { subscribe: (listener: (s: LanghuanState, prev: LanghuanState) => void) => () => void }): void {
  store.subscribe((s, prev) => {
    if (!active) return;
    if (s.annotations !== prev.annotations) void persistLearningFile(LEARNING_PATHS.annotations, { format: "langhuan-annotations", version: 1, annotations: s.annotations }).catch(() => {});
    if (s.savedSearches !== prev.savedSearches) void persistLearningFile(LEARNING_PATHS.searches, { format: "langhuan-saved-searches", version: 1, searches: s.savedSearches }).catch(() => {});
    if (s.quizDocs !== prev.quizDocs) void persistLearningFile(LEARNING_PATHS.quiz, { format: "langhuan-quiz", version: 1, updatedAt: Date.now(), docs: s.quizDocs }).catch(() => {});
  });
  configureScrollMemoryLibrary((progress) => active ? persistLearningFile(LEARNING_PATHS.progress, { format: "langhuan-reading-progress", version: 1, progress }) : Promise.resolve(), (e) => reportLearningError(LEARNING_PATHS.progress, e));
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => { void flushScrollMemoryLibrary().catch(() => {}); });
}

export function isLearningPersistenceReady(): boolean { return active && !hydration && !Object.values(LEARNING_PATHS).some(isLearningReadBlocked); }

export function pauseLearningPersistence(): () => void { const previous = active; active = false; return () => { active = previous; }; }

/** Explicit restore may repair corrupt learning files, but never race hydration. */
export function canPrepareLibraryRestore(): boolean { return active && !hydration; }
