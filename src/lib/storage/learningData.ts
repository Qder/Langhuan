/** Version-1 learning files. No preferences, credentials, bindings or AI drafts. */
import type { Annotation } from "../annotations";
import type { SavedSearch } from "../searchQuery";
import type { DocVersion } from "../types";
import type { QuizDoc, QuizStoreFile } from "../quiz";
import type { ScrollMemoryEntry } from "../scrollMemory";
import type { LearningTopic } from "../learningTopics";
import { isStoredTopic, normalizeTopic } from "../learningTopics";

export const LEARNING_PATHS = {
  annotations: ".langhuan/annotations.json",
  searches: ".langhuan/saved-searches.json",
  progress: ".langhuan/reading-progress.json",
  quiz: ".langhuan/quiz.json",
  topics: ".langhuan/topics.json",
} as const;
/** Files that existed before topics; missing topics in old zips/trees is empty, not an error. */
export const REQUIRED_LEARNING_PATHS = {
  annotations: LEARNING_PATHS.annotations,
  searches: LEARNING_PATHS.searches,
  progress: LEARNING_PATHS.progress,
  quiz: LEARNING_PATHS.quiz,
} as const;
export function versionPath(docId: string): string {
  if (!docId) throw new Error("版本缺少 docId");
  return `.langhuan/versions/${encodeURIComponent(docId)}.json`;
}
export type ProgressMap = Record<string, ScrollMemoryEntry>;
export type LearningFile =
  | { format: "langhuan-annotations"; version: 1; annotations: Annotation[] }
  | { format: "langhuan-saved-searches"; version: 1; searches: SavedSearch[] }
  | { format: "langhuan-reading-progress"; version: 1; progress: ProgressMap }
  | { format: "langhuan-versions"; version: 1; docId: string; versions: DocVersion[] }
  | QuizStoreFile
  | { format: "langhuan-topics"; version: 1; topics: LearningTopic[] };
export function isLearningPath(rel: string): boolean {
  return Object.values(LEARNING_PATHS).includes(rel as typeof LEARNING_PATHS[keyof typeof LEARNING_PATHS]) || /^\.langhuan\/versions\/[^/\\]+\.json$/.test(rel);
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
const array = (v: unknown, check: (v: unknown) => boolean) => Array.isArray(v) && v.every(check);
/** Reject the entire file, not just bad records: never silently overwrite unreadable data. */
export function parseLearningFile(rel: string, raw: string): LearningFile {
  const v: unknown = JSON.parse(raw);
  if (!isLearningPath(rel) || !record(v) || v.version !== 1) throw new Error(`${rel} 格式或版本无效`);
  let valid = false;
  if (rel === LEARNING_PATHS.annotations) valid = v.format === "langhuan-annotations" && array(v.annotations, (a) => record(a) && str(a.id) && str(a.docId) && str(a.path) && str(a.quote) && str(a.note) && finite(a.start) && finite(a.end) && finite(a.plainOffset) && str(a.contextBefore) && str(a.contextAfter) && ["cinnabar", "gold", "teal"].includes(String(a.color)) && ["active", "stale"].includes(String(a.status)) && (a.heading === undefined || str(a.heading)) && finite(a.createdAt) && finite(a.updatedAt));
  if (rel === LEARNING_PATHS.searches) valid = v.format === "langhuan-saved-searches" && array(v.searches, (a) => record(a) && str(a.id) && str(a.name) && str(a.query) && finite(a.createdAt));
  if (rel === LEARNING_PATHS.progress) valid = v.format === "langhuan-reading-progress" && record(v.progress) && Object.entries(v.progress).every(([p, a]) => !!p && record(a) && finite(a.top) && a.top >= 0 && finite(a.ratio) && a.ratio >= 0 && a.ratio <= 1 && finite(a.savedAt));
  if (rel === LEARNING_PATHS.quiz) valid = v.format === "langhuan-quiz" && finite(v.updatedAt) && array(v.docs, (d) => record(d) && str(d.docId) && finite(d.updatedAt) && (d.forceQuiz === undefined || typeof d.forceQuiz === "boolean") && array(d.items, (a) => record(a) && str(a.id) && str(a.stem) && ["unseen", "know", "dont_know", "peeked"].includes(String(a.state)) && finite(a.updatedAt)));
  if (/^\.langhuan\/versions\//.test(rel)) valid = v.format === "langhuan-versions" && str(v.docId) && versionPath(v.docId) === rel && array(v.versions, (a) => record(a) && str(a.id) && a.docId === v.docId && str(a.path) && str(a.content) && finite(a.savedAt));
  if (rel === LEARNING_PATHS.topics) valid = v.format === "langhuan-topics" && array(v.topics, (t) => isStoredTopic(t));
  if (!valid) throw new Error(`${rel} 数据损坏；保留原文件，请检查后重试`);

  if (rel === LEARNING_PATHS.topics && v.format === "langhuan-topics") {
    return {
      format: "langhuan-topics",
      version: 1,
      topics: (v.topics as LearningTopic[]).map((t) => normalizeTopic(t)!),
    };
  }
  return v as LearningFile;
}
/** Union by identity; newer timestamp wins, ties favour the library. */
export function mergeRecords<T>(old: T[], library: T[], id: (v: T) => string, time: (v: T) => number): T[] {
  const byId = new Map(old.map((v) => [id(v), v]));
  for (const v of library) {
    const prev = byId.get(id(v));
    if (!prev || time(v) >= time(prev)) byId.set(id(v), prev ? { ...prev, ...v } : v);
    else byId.set(id(v), { ...v, ...prev });
  }
  return [...byId.values()].sort((a, b) => time(b) - time(a) || id(a).localeCompare(id(b)));
}
export const mergeAnnotations = (old: Annotation[], lib: Annotation[]) => mergeRecords(old, lib, (v) => v.id, (v) => v.updatedAt);
export const mergeSearches = (old: SavedSearch[], lib: SavedSearch[]) => mergeRecords(old, lib, (v) => v.id, (v) => v.createdAt).slice(0, 30);
export const mergeVersions = (old: DocVersion[], lib: DocVersion[]) => mergeRecords(old, lib, (v) => v.id, (v) => v.savedAt).slice(0, 20);
export function mergeProgress(old: ProgressMap, lib: ProgressMap): ProgressMap {
  const result = Object.assign(Object.create(null) as ProgressMap, old);
  for (const [p, v] of Object.entries(lib)) if (!result[p] || v.savedAt >= result[p].savedAt) result[p] = v;
  return result;
}
export function mergeQuiz(old: QuizDoc[], lib: QuizDoc[]): QuizDoc[] {
  const docs = mergeRecords(old, lib, (d) => d.docId, (d) => d.updatedAt);
  const a = new Map(old.map((d) => [d.docId, d])); const b = new Map(lib.map((d) => [d.docId, d]));
  return docs.map((d) => ({ ...d, items: mergeRecords(a.get(d.docId)?.items ?? [], b.get(d.docId)?.items ?? [], (v) => v.id, (v) => v.updatedAt) }));
}

export const mergeTopics = (old: LearningTopic[], lib: LearningTopic[]) =>
  mergeRecords(old, lib, (v) => v.id, (v) => v.updatedAt);
