"use client";
import { get, set, keys } from "idb-keyval";
import { uid } from "../utils";
import type { DocVersion } from "../types";
import { MAX_VERSIONS_PER_DOC, VERSIONS_KEY_PREFIX } from "./constants";
import { versionPath, mergeVersions, type LearningFile } from "./learningData";
import { libraryLearningIO, serializeLearning, reportLearningError } from "./learningIO";
const memory = new Map<string, DocVersion[]>();
const keyFor = (id: string) => `${VERSIONS_KEY_PREFIX}${id}`;
async function loadUnlocked(docId: string): Promise<{ versions: DocVersion[]; readable: boolean; file: LearningFile | null }> {
  const path = versionPath(docId);
  let old = memory.get(docId) ?? [];
  try { old = mergeVersions((await get<DocVersion[]>(keyFor(docId))) ?? [], old); }
  catch (e) { reportLearningError(keyFor(docId), e); }
  let file: LearningFile | null = null; let readable = true;
  try { file = await libraryLearningIO.read(path); }
  catch (e) { readable = false; reportLearningError(path, e); }
  const versions = mergeVersions(old, file?.format === "langhuan-versions" ? file.versions : []);
  memory.set(docId, versions);
  return { versions, readable, file };
}
async function storeUnlocked(docId: string, versions: DocVersion[], readable: boolean, file: LearningFile | null): Promise<void> {
  const path = versionPath(docId);
  memory.set(docId, versions);
  try { await set(keyFor(docId), versions); }
  catch (e) { reportLearningError(keyFor(docId), e); }
  if (!readable || (!file && !versions.length)) return;
  const next: LearningFile = { format: "langhuan-versions", version: 1, docId, versions };
  if (JSON.stringify(file) === JSON.stringify(next)) return;
  try { await libraryLearningIO.write(path, next); }
  catch (e) { reportLearningError(path, e); }
}
/** Also retries a previous migration/write failure. Old IDB keys are never removed. */
export async function listVersions(docId: string): Promise<DocVersion[]> {
  return serializeLearning(versionPath(docId), async () => {
    const loaded = await loadUnlocked(docId);
    await storeUnlocked(docId, loaded.versions, loaded.readable, loaded.file);
    return loaded.versions;
  });
}
export async function pushVersion(input: { docId: string; content: string; path: string; max?: number }): Promise<DocVersion | null> {
  return serializeLearning(versionPath(input.docId), async () => {
    const loaded = await loadUnlocked(input.docId);
    if (loaded.versions[0]?.content === input.content && loaded.versions[0]?.path === input.path) {
      await storeUnlocked(input.docId, loaded.versions, loaded.readable, loaded.file);
      return null;
    }
    const snap: DocVersion = { id: uid("ver"), docId: input.docId, content: input.content, path: input.path, savedAt: Date.now() };
    const max = Math.max(1, Math.min(MAX_VERSIONS_PER_DOC, input.max ?? MAX_VERSIONS_PER_DOC));
    const versions = [snap, ...loaded.versions].slice(0, max);
    await storeUnlocked(input.docId, versions, loaded.readable, loaded.file);
    return snap;
  });
}
export async function getVersion(docId: string, versionId: string): Promise<DocVersion | null> {
  return (await listVersions(docId)).find((v) => v.id === versionId) ?? null;
}
/** Retain pre-migration rollback copies, including histories for removed notes. */
export async function clearVersions(_docId: string): Promise<void> { void _docId; /* No destructive cleanup in this migration. */ }
export async function migrateAllVersions(knownIds: string[]): Promise<void> {
  const ids = new Set(knownIds);
  try {
    for (const key of await keys()) if (typeof key === "string" && key.startsWith(VERSIONS_KEY_PREFIX)) ids.add(key.slice(VERSIONS_KEY_PREFIX.length));
  } catch (e) { reportLearningError("版本迁移枚举", e); }
  for (const id of ids) if (id) await listVersions(id);
}
export async function estimateVersionsBytes(docIds: string[]): Promise<number> {
  let total = 0;
  // Hydration already dual-wrote known histories; usage refresh must not fetch every
  // per-doc file again on every note save.
  for (const id of docIds) {
    try { total += new Blob([JSON.stringify((await get<DocVersion[]>(keyFor(id))) ?? memory.get(id) ?? [])]).size; }
    catch { total += new Blob([JSON.stringify(memory.get(id) ?? [])]).size; }
  }
  return total;
}

/** Explicit confirmed restore only. Old keys remain, but the active rollback values
 * must match the adopted library, or startup union would resurrect replaced history.
 * The complete prior library is retained by the restore transaction in archives/. */
export async function adoptRestoredVersions(restored: Record<string, DocVersion[]>): Promise<void> {
  memory.clear();
  const ids = new Set(Object.keys(restored));
  for (const key of await keys()) if (typeof key === "string" && key.startsWith(VERSIONS_KEY_PREFIX)) ids.add(key.slice(VERSIONS_KEY_PREFIX.length));
  for (const id of ids) await serializeLearning(versionPath(id), async () => { const list = restored[id] ?? []; await set(keyFor(id), list); memory.set(id, list); });
}
