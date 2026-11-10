"use client";
import { get, keys } from "idb-keyval";
import { fetchBackupSnapshot } from "./backupApi";
import { payloadFromBackupTree } from "./backupTree";
import {
  LEARNING_PATHS,
  versionPath,
  mergeVersions,
  mergeAnnotations,
  mergeQuiz,
  mergeSearches,
} from "./learningData";
import type { BackupSnapshot } from "./backupProtocol";
import type { BackupPayload } from "./backup";
import type { DocVersion } from "../types";
import { readScrollMemoryMap } from "../scrollMemory";
import { VERSIONS_KEY_PREFIX } from "./constants";
import { getAssetBlob, blobToBase64 } from "../assets/store";
import { waitForLearningWrites } from "./learningIO";
/** A snapshot read is pure: no scan/index rebuild, cache fill or live import. */
export async function collectBackup(
  fallback: BackupPayload,
  suppliedSnapshot?: BackupSnapshot,
) {
  await waitForLearningWrites();
  const snapshot = suppliedSnapshot ?? (await fetchBackupSnapshot());
  const p = payloadFromBackupTree(snapshot);
  const paths = new Set(snapshot.files.map((f) => f.path));
  if (!paths.has(".langhuan/index.json")) p.documents = fallback.documents;
  if (!paths.has(".langhuan/assets.json")) p.assets = fallback.assets ?? [];
  if (!paths.has(".langhuan/trash.json")) p.trash = fallback.trash;
  p.readingPrefs = fallback.readingPrefs;
  for (const asset of p.assets ?? [])
    if (p.assetBinaries?.[asset.id] === undefined) {
      const old = fallback.assetBinaries?.[asset.id];
      if (old !== undefined) p.assetBinaries![asset.id] = old;
      else {
        const blob = await getAssetBlob(asset.id);
        if (blob) p.assetBinaries![asset.id] = await blobToBase64(blob);
      }
    }
  p.annotations = mergeAnnotations(
    fallback.annotations ?? [],
    p.annotations ?? [],
  );
  p.quizDocs = mergeQuiz(fallback.quizDocs ?? [], p.quizDocs ?? []);
  p.savedSearches = mergeSearches(
    fallback.savedSearches ?? [],
    p.savedSearches ?? [],
  );
  if (!paths.has(LEARNING_PATHS.progress))
    p.readingProgress = fallback.readingProgress ?? readScrollMemoryMap();
  // Include still-pending old-store snapshots without writing/migrating during preview.
  try {
    for (const key of await keys())
      if (typeof key === "string" && key.startsWith(VERSIONS_KEY_PREFIX)) {
        const id = key.slice(VERSIONS_KEY_PREFIX.length);
        const old = (await get<DocVersion[]>(key)) ?? [];
        p.versions![id] = mergeVersions(old, p.versions?.[id] ?? []);
      }
  } catch (e) {
    throw new Error(
      `旧版本回滚副本读取失败，未将不确定数据标为完整备份：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  for (const [id, versions] of Object.entries(fallback.versions ?? {}))
    if (!paths.has(versionPath(id))) p.versions![id] = versions;
  return { payload: p, snapshot };
}
