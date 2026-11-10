"use client";
import { get, set, keys } from "idb-keyval";
import { fetchBackupRestoreState, fetchBackupSnapshot } from "./backupApi";
import { assignBackupLearning, type BackupPayload } from "./backup";
import { parseLearningFile, LEARNING_PATHS } from "./learningData";
import { base64Text } from "./backupProtocol";
import { adoptRestoredVersions } from "./versions";
import { hydrateScrollMemoryMap, readScrollMemoryMap } from "../scrollMemory";
import { idbJSONStorage, STORE_KEY } from "./idbPersist";
import { setLearningReadBlocked } from "./learningIO";
import { payloadFromBackupTree } from "./backupTree";
import {
  putAssetBlob,
  saveAssetMetaList,
  revokeAssetObjectUrl,
  base64ToBlob,
  ASSET_BLOB_PREFIX,
  ASSET_META_KEY,
} from "../assets/store";
import type { LanghuanState } from "../store/types";
const ADOPTED_KEY = "langhuan-backup-adopted-generation";
/** A durable marker retries local-store adoption after a crash/IDB failure. */
export async function ensureBackupAdoption(
  _get: () => LanghuanState,
  change: (s: Partial<LanghuanState>) => void,
): Promise<void> {
  const state = await fetchBackupRestoreState();
  if (!state || (await get(ADOPTED_KEY)) === state.generation) return;
  const payload: BackupPayload = {
    documents: [],
    trash: [],
    annotations: [],
    quizDocs: [],
    savedSearches: [],
    versions: Object.create(null),
    readingProgress: {},
  };
  for (const f of state.files)
    assignBackupLearning(
      payload,
      parseLearningFile(f.path, base64Text(f.base64)),
    );
  for (const path of Object.values(LEARNING_PATHS))
    if (!state.files.some((f) => f.path === path))
      throw new Error(`恢复学习文件缺失：${path}；尚未替换本机旧数据`);
  const snapshot = await fetchBackupSnapshot();
  const stamp = snapshot.files.find(
    (f) => f.path === ".langhuan/restore-state.json",
  );
  if (
    !stamp ||
    JSON.parse(base64Text(stamp.base64)).generation !== state.generation
  )
    throw new Error("恢复代次已变化，请重试本机接纳");
  const restored = payloadFromBackupTree(snapshot);
  // Retain filtered pre-adoption device learning/drafts/cache as a passive rollback
  // copy, not an active draft store. Never copy IDE settings, bindings or secrets.
  const rollbackKey = `langhuan-backup-local-rollback:${state.generation}`;
  if ((await get(rollbackKey)) === undefined) {
    const old = await idbJSONStorage!.getItem(STORE_KEY);
    const raw = old?.state as Partial<LanghuanState> | undefined;
    const current = _get();
    const versions: Record<string, unknown> = {};
    const assetBlobs: Record<string, unknown> = {};
    for (const key of await keys())
      if (typeof key === "string") {
        if (key.startsWith("langhuan-versions:"))
          versions[key] = await get(key);
        if (key.startsWith(ASSET_BLOB_PREFIX)) assetBlobs[key] = await get(key);
      }
    const learning = (s: Partial<LanghuanState> | undefined) => ({
      annotations: s?.annotations ?? [],
      quizDocs: s?.quizDocs ?? [],
      savedSearches: s?.savedSearches ?? [],
      drafts: s?.drafts ?? {},
    });
    await set(rollbackKey, {
      memory: learning(current),
      oldStore: learning(raw),
      paths: Object.fromEntries(
        (current.documents ?? []).map((d) => [d.id, d.path]),
      ),
      progress: readScrollMemoryMap(),
      versions,
      assetMetadata: await get(ASSET_META_KEY),
      assetBlobs,
    });
  }
  // Only after explicit apply: refresh rollback/offline caches, never during preview.
  for (const asset of restored.assets ?? []) {
    const binary = restored.assetBinaries?.[asset.id];
    if (binary === undefined) throw new Error(`恢复附件缺失：${asset.path}`);
    await putAssetBlob(asset.id, base64ToBlob(binary, asset.mime));
    revokeAssetObjectUrl(asset.id);
  }
  await saveAssetMetaList(restored.assets ?? []);
  await adoptRestoredVersions(payload.versions ?? {});
  hydrateScrollMemoryMap(payload.readingProgress ?? {});
  change({
    annotations: payload.annotations,
    quizDocs: payload.quizDocs,
    savedSearches: payload.savedSearches,
    drafts: {},
    activeId: null,
  });
  const old = await idbJSONStorage!.getItem(STORE_KEY);
  await idbJSONStorage!.setItem(STORE_KEY, {
    version: old?.version ?? 9,
    state: {
      ...((old?.state as object) ?? {}),
      annotations: payload.annotations,
      quizDocs: payload.quizDocs,
      savedSearches: payload.savedSearches,
      drafts: {},
      activeId: null,
    },
  });
  for (const path of Object.values(LEARNING_PATHS))
    setLearningReadBlocked(path, false);
  await set(ADOPTED_KEY, state.generation);
}
