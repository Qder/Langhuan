import type { Annotation } from "../annotations";
import type { SavedSearch } from "../searchQuery";
import type { QuizDoc } from "../quiz";
import { LEARNING_PATHS, mergeAnnotations, mergeSearches, mergeProgress, mergeQuiz, mergeTopics, type LearningFile, type ProgressMap } from "./learningData";
import type { LearningTopic } from "../learningTopics";
import type { LearningIO } from "./learningIO";
export type LearningState = { annotations: Annotation[]; savedSearches: SavedSearch[]; quizDocs: QuizDoc[]; progress: ProgressMap; topics: LearningTopic[] };
/** Read first, then merge with the latest old-store snapshot. Failed reads are not writable. */
export async function migrateLearningData(old: () => LearningState, io: LearningIO, apply: (merged: LearningState) => void): Promise<{ errors: string[]; blocked: string[] }> {
  const errors: string[] = [];
  const files = new Map<string, LearningFile | null>();
  const blocked = new Set<string>();
  await Promise.all(Object.values(LEARNING_PATHS).map(async (path) => {
    try { files.set(path, await io.read(path)); }
    catch (e) { blocked.add(path); errors.push(`${path}：${e instanceof Error ? e.message : String(e)}`); }
  }));
  const local = old();
  const ann = files.get(LEARNING_PATHS.annotations), search = files.get(LEARNING_PATHS.searches);
  const progress = files.get(LEARNING_PATHS.progress), quiz = files.get(LEARNING_PATHS.quiz);
  const topics = files.get(LEARNING_PATHS.topics);
  const merged: LearningState = {
    annotations: mergeAnnotations(local.annotations, ann?.format === "langhuan-annotations" ? ann.annotations : []),
    savedSearches: mergeSearches(local.savedSearches, search?.format === "langhuan-saved-searches" ? search.searches : []),
    quizDocs: mergeQuiz(local.quizDocs ?? [], quiz?.format === "langhuan-quiz" ? quiz.docs : []),
    progress: mergeProgress(local.progress, progress?.format === "langhuan-reading-progress" ? progress.progress : {}),
    topics: mergeTopics(local.topics ?? [], topics?.format === "langhuan-topics" ? topics.topics : []),
  };
  // Apply before writing: a failed write cannot empty the in-memory/old-store fallback.
  apply(merged);
  const values: [string, LearningFile][] = [
    [LEARNING_PATHS.annotations, { format: "langhuan-annotations", version: 1, annotations: merged.annotations }],
    [LEARNING_PATHS.searches, { format: "langhuan-saved-searches", version: 1, searches: merged.savedSearches }],
    [LEARNING_PATHS.progress, { format: "langhuan-reading-progress", version: 1, progress: merged.progress }],
    [LEARNING_PATHS.quiz, { format: "langhuan-quiz", version: 1, updatedAt: Date.now(), docs: merged.quizDocs }],
    [LEARNING_PATHS.topics, { format: "langhuan-topics", version: 1, topics: merged.topics }],
  ];
  await Promise.all(values.map(async ([path, value]) => {
    if (blocked.has(path)) return;
    try { await io.write(path, value); }
    catch (e) { errors.push(`${path}：${e instanceof Error ? e.message : String(e)}`); }
  }));
  return { errors, blocked: [...blocked] };
}
