"use client";

import type { StateCreator } from "zustand";
import type { Document } from "../../types";
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
  fetchQuizStore,
  putQuizStore,
} from "../../storage/contentApi";
import { takeIdbLibrary } from "../../storage/contentMigration";
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
  applySyncedDocuments: (docs) => {
        const prevDrafts = get().drafts;
        const nextIds = new Set(docs.map((d) => d.id));
        const drafts = Object.fromEntries(
          Object.entries(prevDrafts).filter(([id]) => nextIds.has(id))
        );
        const activeId = get().activeId;
        set({
          documents: docs,
          drafts,
          activeId: activeId && nextIds.has(activeId) ? activeId : activeId,
        });
        // Mirror optional FS-Access sync result into primary content/
        void bulkWriteLibrary({ documents: docs, assets: get().assets }).catch(() => {});
        void get().refreshStorageUsage();
      },
  exportPayload: () => ({
        documents: get().documents,
        trash: get().trash,
        assets: get().assets,
        annotations: get().annotations,
        readingPrefs: get().readingPrefs,
        quizDocs: get().quizDocs,
      }),
  importLibrary: (payload, mode) => {
        if (mode === "replace") {
          const oldIds = get().documents.map((d) => d.id);
          const assets = payload.assets || [];
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
          void bulkWriteLibrary({
            documents: payload.documents,
            trash: payload.trash || [],
          }).catch(() => {});
          get().setStatus(`已替换导入 ${payload.documents.length} 篇文档`);
          void get().refreshStorageUsage();
          return payload.documents.length;
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
        set({
          documents: nextDocs,
          assets: nextAssets,
          annotations: nextAnn,
          quizDocs: nextQuiz,
        });
        void saveAssetMetaList(nextAssets);
        void bulkWriteLibrary({ documents: nextDocs }).catch(() => {});
        get().setStatus(`已合并导入 ${n} 篇文档`);
        void get().refreshStorageUsage();
        return n;
      },
  hydrateFromContent: async () => {
        try {
          const snap = await fetchLibrary();
          const pending = takeIdbLibrary();
          if (snap.documents.length || snap.assets.length || snap.trash.length) {
            set({
              documents: snap.documents,
              assets: snap.assets,
              trash: snap.trash,
            });
            void saveAssetMetaList(snap.assets);
            void fetchQuizStore()
              .then((qs) => {
                if (qs.docs?.length) {
                  const local = get().quizDocs || [];
                  const byId = new Map(local.map((d) => [d.docId, d]));
                  for (const d of qs.docs) {
                    const ex = byId.get(d.docId);
                    if (!ex || (d.updatedAt || 0) >= (ex.updatedAt || 0)) {
                      byId.set(d.docId, d);
                    }
                  }
                  const merged = [...byId.values()];
                  set({ quizDocs: merged });
                  void putQuizStore({
                    format: "langhuan-quiz",
                    version: 1,
                    updatedAt: Date.now(),
                    docs: merged,
                  });
                } else if ((get().quizDocs || []).length) {
                  void putQuizStore({
                    format: "langhuan-quiz",
                    version: 1,
                    updatedAt: Date.now(),
                    docs: get().quizDocs,
                  });
                }
              })
              .catch(() => {});
            get().setStatus(`已从 content/ 载入 ${snap.documents.length} 篇`);
            void get().refreshStorageUsage();
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
