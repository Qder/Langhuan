"use client";
import { fetchBackupRestoreState } from "../../storage/backupApi";

import type { StateCreator } from "zustand";
import { readScrollMemoryMap } from "../../scrollMemory";
import { hydrateLearningState } from "../../storage/learningPersistence";
import { keepContentDrafts } from "../helpers/persistSchedule";
import type { Document, TrashItem } from "../../types";
import { normalizeReadingPrefs } from "../../readingPrefs";
import { createSeedDocuments } from "../../seed";
import { uid } from "../../utils";
import { saveAssetMetaList } from "../../assets/store";
import { clearVersions } from "../../storage/versions";
import {
  computeStorageUsage,
  measureLibraryBytes,
} from "../../storage/usage";
import {
  blobToBase64,
  bulkWriteLibrary,
  fetchLibrary,
} from "../../storage/contentApi";
import { takeIdbLibrary } from "../../storage/contentMigration";
import { pruneStaleIndexes } from "../../locate/indexFreshness";
import { ensureUniquePath } from "../helpers/paths";
import type { LanghuanState } from "../types";

type SyncBackupSliceKeys =
  | "storageUsage"
  | "storageBytes"
  | "refreshStorageUsage"
  | "applySyncedDocuments"
  | "exportPayload"
  | "importLibrary"
  | "hydrateFromContent"
  | "resetSeed";

export type SyncBackupSlice = Pick<LanghuanState, SyncBackupSliceKeys>;

export const createSyncBackupSlice: StateCreator<
  LanghuanState,
  [],
  [],
  SyncBackupSlice
> = (set, get) => ({
  storageUsage: null,
  storageBytes: () => {
        const { documents, drafts, trash } = get();
        return measureLibraryBytes(documents, drafts, trash);
      },
  refreshStorageUsage: async () => {
        const { documents, drafts, trash } = get();
        try {
          const usage = await computeStorageUsage(documents, drafts, trash);
          set({ storageUsage: usage });
        } catch {
          /* ignore */
        }
      },
  applySyncedDocuments: (docs, nextAssets) => {
        const prevDrafts = get().drafts;
        const nextIds = new Set(docs.map((d) => d.id));
        const drafts = Object.fromEntries(
          Object.entries(prevDrafts).filter(([id]) => nextIds.has(id))
        );
        const activeId = get().activeId;
        const assets = nextAssets ?? get().assets;
        set({
          documents: docs,
          drafts,
          assets,
          activeId: activeId && nextIds.has(activeId) ? activeId : activeId,
        });
        if (nextAssets) {
          void saveAssetMetaList(nextAssets);
        }
        // Mirror optional FS-Access sync result into primary content/
        void bulkWriteLibrary({ documents: docs, assets }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          keepContentDrafts(get, set, docs.map((d) => d.id));
          get().setStatus(`写入 content/ 失败，草稿已保留，可重新保存：${msg}`);
        });
        void get().refreshStorageUsage();
      },
  exportPayload: () => ({
        documents: get().documents,
        trash: get().trash,
        assets: get().assets,
        annotations: get().annotations,
        readingPrefs: get().readingPrefs,
        quizDocs: get().quizDocs,
        savedSearches: get().savedSearches,
        readingProgress: readScrollMemoryMap(),
      }),
  importLibrary: async (payload, mode) => {
        const beforeDocuments = get().documents;
        const beforeDrafts = get().drafts;
        const persistImport = async (documents: Document[], trash?: TrashItem[]) => {
          try {
            await bulkWriteLibrary({ documents, ...(trash ? { trash } : {}) });
            if (get().documents !== beforeDocuments || get().drafts !== beforeDrafts) {
              throw new Error("导入期间笔记发生变化，当前内容已保留；主库可能已部分写入，请检查后重试");
            }
          } catch (e) {
            keepContentDrafts(get, set, get().documents.map((d) => d.id));
            get().setStatus(`导入写入失败，原有内容与草稿已保留，可重试：${e instanceof Error ? e.message : String(e)}`);
            throw e;
          }
        };
        if (mode === "replace") {
          const oldIds = get().documents.map((d) => d.id);
          const assets = payload.assets || [];
          await persistImport(payload.documents, payload.trash || []);
          set({
            documents: payload.documents,
            trash: payload.trash || [],
            drafts: {},
            activeId: null,
            assets,
            annotations: payload.annotations || [],
            quizDocs: payload.quizDocs || [],
            readingPrefs: payload.readingPrefs
              ? normalizeReadingPrefs(payload.readingPrefs)
              : get().readingPrefs,
          });
          void saveAssetMetaList(assets);
          for (const id of oldIds) void clearVersions(id);
          const replaceCount = payload.documents.length;
          get().setStatus(`已替换导入 ${replaceCount} 篇文档`);
          void get().refreshStorageUsage();
          return replaceCount;
        }

        // merge: by path — overwrite content/meta if path exists, else add
        const byPath = new Map(get().documents.map((d) => [d.path, d]));
        let n = 0;
        const nextDocs = [...get().documents];
        for (const incoming of payload.documents) {
          const existing = byPath.get(incoming.path);
          if (existing) {
            const idx = nextDocs.findIndex((d) => d.id === existing.id);
            if (idx >= 0) {
              nextDocs[idx] = {
                ...existing,
                content: incoming.content,
                starred: incoming.starred,
                type: incoming.type,
                updatedAt: Date.now(),
              };
              n += 1;
            }
          } else {
            const doc: Document = {
              ...incoming,
              id: uid(),
              path: ensureUniquePath(incoming.path, nextDocs),
              updatedAt: Date.now(),
            };
            nextDocs.push(doc);
            byPath.set(doc.path, doc);
            n += 1;
          }
        }
        let nextAssets = [...get().assets];
        if (payload.assets?.length) {
          const byPath = new Map(nextAssets.map((a) => [a.path, a]));
          for (const a of payload.assets) {
            const ex = byPath.get(a.path);
            if (ex) {
              nextAssets = nextAssets.map((x) => (x.id === ex.id ? { ...a, id: ex.id } : x));
            } else {
              nextAssets.push(a);
              byPath.set(a.path, a);
            }
          }
        }
        let nextAnn = get().annotations;
        if (payload.annotations?.length) {
          const ids = new Set(nextAnn.map((a) => a.id));
          nextAnn = [
            ...nextAnn,
            ...payload.annotations.filter((a) => !ids.has(a.id)),
          ];
        }
        let nextQuiz = get().quizDocs;
        if (payload.quizDocs?.length) {
          const byId = new Map(nextQuiz.map((d) => [d.docId, d]));
          for (const q of payload.quizDocs) {
            const ex = byId.get(q.docId);
            if (!ex || (q.updatedAt || 0) >= (ex.updatedAt || 0)) {
              byId.set(q.docId, q);
            }
          }
          nextQuiz = [...byId.values()];
        }
        await persistImport(nextDocs);
        set({
          documents: nextDocs,
          assets: nextAssets,
          annotations: nextAnn,
          quizDocs: nextQuiz,
        });
        void saveAssetMetaList(nextAssets);
        const mergeCount = n;
        get().setStatus(`已合并导入 ${mergeCount} 篇文档`);
        void get().refreshStorageUsage();
        return mergeCount;
      },
  hydrateFromContent: async () => {
        try {
          const snap = await fetchLibrary();
          const pending = takeIdbLibrary();
          if (snap.documents.length || snap.assets.length || snap.trash.length) {
            // 快照里的索引可能是上次会话留下的：源码指纹对不上的先剔掉，
            // 免得「改过 .css/.js 之后点元素跳到旧行号」。留着的那部分按需复用。
            const sourceSnapshot = {
              projects: snap.projects ?? [],
              projectTexts: snap.projectTexts ?? {},
            };
            set({
              documents: snap.documents,
              assets: snap.assets,
              trash: snap.trash,
              projects: sourceSnapshot.projects,
              projectTexts: sourceSnapshot.projectTexts,
              cssIndexes: pruneStaleIndexes("css", snap.cssIndexes ?? [], sourceSnapshot),
              jsIndexes: pruneStaleIndexes("js", snap.jsIndexes ?? [], sourceSnapshot),
            });
            void saveAssetMetaList(snap.assets);
            get().setStatus(`已从 content/ 载入 ${snap.documents.length} 篇`);
            void get().refreshStorageUsage();
            return;
          }
          // A deliberately empty restored library must not resurrect IDB notes or seed examples.
          if ((await fetchBackupRestoreState())?.generation) {
            set({ documents: [], assets: [], trash: [], activeId: null });
            get().setStatus("已载入恢复后的空库；未重新写入旧库或示例");
            return;
          }
          if (pending && (pending.documents.length || pending.assets.length)) {
            // One-shot migrate IDB library → content/
            const assetPayload = [];
            for (const a of pending.assets) {
              try {
                const { getAssetBlob } = await import("../../assets/store");
                const blob = await getAssetBlob(a.id);
                if (blob) {
                  const b64 = await blobToBase64(blob);
                  assetPayload.push({ ...a, base64: b64 });
                } else {
                  assetPayload.push(a);
                }
              } catch {
                assetPayload.push(a);
              }
            }
            const written = await bulkWriteLibrary({
              documents: pending.documents,
              assets: assetPayload,
              trash: pending.trash,
            });
            set({
              documents: written.documents,
              assets: written.assets,
              trash: written.trash,
            });
            void saveAssetMetaList(written.assets);
            get().setStatus(`已将浏览器旧库迁移到 content/（${written.documents.length} 篇）`);
            void get().refreshStorageUsage();
            return;
          }
          // Empty content/ — seed once
          const seeds = createSeedDocuments();
          const written = await bulkWriteLibrary({ documents: seeds, seed: true });
          set({
            documents: written.documents.length ? written.documents : seeds,
            assets: written.assets,
            trash: written.trash,
          });
          get().setStatus("已初始化示例文档到 content/");
          void get().refreshStorageUsage();
        } catch (e) {
          const pending = takeIdbLibrary();
          if (pending && pending.documents.length) {
            set({
              documents: pending.documents,
              assets: pending.assets,
              trash: pending.trash,
            });
            get().setStatus("content/ API 不可用，暂用浏览器旧数据");
          } else if (!get().documents.length) {
            set({ documents: createSeedDocuments() });
            get().setStatus("content/ API 不可用，使用内存示例库");
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            get().setStatus(`载入 content/ 失败：${msg}`);
          }
        } finally {
          await hydrateLearningState(get, set);
        }
      },
  resetSeed: () => {
        const seeds = createSeedDocuments();
        set({
          documents: seeds,
          drafts: {},
          activeId: null,
        });
        void bulkWriteLibrary({ documents: seeds, seed: true })
          .then(() => get().setStatus("已恢复示例文档到 content/"))
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            get().setStatus(`示例写入失败：${msg}`);
          });
        void get().refreshStorageUsage();
      },
});
