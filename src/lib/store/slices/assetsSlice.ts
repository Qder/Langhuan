"use client";

import type { StateCreator } from "zustand";
import { persistLearningFile } from "../../storage/learningIO";
import { LEARNING_PATHS } from "../../storage/learningData";
import type { AssetMeta } from "../../types";
import { createAnnotation, updateAnnotationNote, resolveAnnotation, normalizeAnnotation, rematchAnnotationWithAnchor, summarizeReanchor, formatReanchorStatus, type RematchResult } from "../../annotations";
import {
  setQuizItemState as applyQuizItemState,
  syncQuizDocFromSource,
  upsertQuizDoc,
  type QuizDoc,
} from "../../quiz";
import {
  deleteAssetBlob,
  putAssetBlob,
  saveAssetMetaList,
} from "../../assets/store";
import {
  markdownImageSnippet,
  relativeAssetHref,
  suggestAssetPath,
  extFromMime,
  sanitizeAssetFilename,
} from "../../assets/paths";
import {
  suggestedImageFilename,
  validateLibraryImageFile,
} from "../../assets/imageUpload";
import {
  isImportableImagePath,
  mimeForImportableImage,
} from "../../importable";
import { basename, dirname, uniquePath, uid } from "../../utils";
import {
  blobToBase64,
  deleteLibraryAsset,
  putLibraryAsset,
} from "../../storage/contentApi";
import type { LanghuanState } from "../types";

type AssetsSliceKeys =
  | "assets"
  | "annotations"
  | "quizDocs"
  | "importAssets"
  | "ingestImageFile"
  | "removeAsset"
  | "assetsForDoc"
  | "addAnnotation"
  | "updateAnnotation"
  | "removeAnnotation"
  | "reanchorDocAnnotations"
  | "upsertQuizDoc"
  | "setQuizItemState"
  | "setQuizForce"
  | "syncQuizForDoc"
  | "persistQuizStore";

export type AssetsSlice = Pick<LanghuanState, AssetsSliceKeys>;

export const createAssetsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  AssetsSlice
> = (set, get) => ({
  assets: [],
  annotations: [],
  quizDocs: [],
  importAssets: async (files, opts) => {
        let m = 0;
        const errors: string[] = [];
        const docs = get().documents;
        const addedAssets: AssetMeta[] = [];
        const pathSet = new Set<string>([
          ...docs.map((d) => d.path),
          ...get().assets.map((a) => a.path),
        ]);

        for (const f of files) {
          let path = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
          if (!isImportableImagePath(path)) continue;
          path = uniquePath(path, pathSet);
          pathSet.add(path);

          const mime = mimeForImportableImage(path, f.mime);
          const blob =
            f.blob instanceof Blob ? f.blob : new Blob([f.blob], { type: mime });
          const id = uid("asset");
          // Prefer content/ on disk; IDB blob kept as offline cache fallback only.
          try {
            await putAssetBlob(id, blob);
          } catch {
            /* optional cache */
          }

          const dir = dirname(path);
          const sameDir = docs.filter((d) => dirname(d.path) === dir);
          const nearest =
            sameDir.find((d) => d.type === "md") ||
            sameDir.find((d) => /\.(html|svg)$/i.test(d.path)) ||
            undefined;

          const meta: AssetMeta = {
            id,
            path,
            mime,
            size: blob.size,
            createdAt: Date.now(),
            docId: nearest?.id,
          };
          try {
            const b64 = await blobToBase64(blob);
            await putLibraryAsset({
              path,
              base64: b64,
              mime,
              id,
              docId: nearest?.id,
              createdAt: meta.createdAt,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${path}：${msg}`);
            continue;
          }
          addedAssets.push(meta);
          m += 1;

          try {
            const { writeThroughAssetBinary } = await import("../../storage/fsSync");
            void writeThroughAssetBinary(path, blob);
          } catch {
            /* optional mirror */
          }
        }

        if (m) {
          const assets = [...get().assets, ...addedAssets];
          set({ assets });
          void saveAssetMetaList(assets);
          void get().refreshStorageUsage();
          if (!opts?.quiet) get().setStatus(`已导入 ${m} 张图片`);
        }
        if (errors.length) get().setStatus(`附件导入失败（${errors.length} 项，可重新选择重试）：${errors.join("；")}`);
        return m;
      },
  ingestImageFile: async (docId, file, filename) => {
        const doc = get().documents.find((d) => d.id === docId);
        if (!doc) return null;
        const validation = validateLibraryImageFile({
          type: (file as File).type,
          name: filename || (file as File).name,
          size: file instanceof Blob ? file.size : 0,
        });
        if (!validation.ok) {
          get().setStatus(validation.message);
          return null;
        }
        const mime = validation.mime;
        const name =
          filename ||
          suggestedImageFilename(file as File, mime) ||
          `image.${extFromMime(mime)}`;
        const existing = [
          ...get().documents.map((d) => d.path),
          ...get().assets.map((a) => a.path),
        ];
        const path = suggestAssetPath(doc.path, sanitizeAssetFilename(name), existing);
        const id = uid("asset");
        const blob =
          file instanceof Blob ? file : new Blob([file], { type: mime });
        try {
          await putAssetBlob(id, blob);
        } catch {
          /* optional IDB cache */
        }
        const meta: AssetMeta = {
          id,
          path,
          mime,
          size: blob.size,
          createdAt: Date.now(),
          docId,
        };
        try {
          const b64 = await blobToBase64(blob);
          await putLibraryAsset({
            path,
            base64: b64,
            mime,
            id,
            docId,
            createdAt: meta.createdAt,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          get().setStatus(`附件写入 content/ 失败，请重新选择重试：${msg}`);
          return null;
        }
        const assets = [...get().assets, meta];
        set({ assets });
        void saveAssetMetaList(assets);
        const href = relativeAssetHref(doc.path, path);
        const snippet = markdownImageSnippet(href, sanitizeAssetFilename(name).replace(/\.[^.]+$/, ""));
        get().setStatus(`已入库图片 ${basename(path)}`);
        void get().refreshStorageUsage();
        try {
          const { writeThroughAssetBinary } = await import("../../storage/fsSync");
          void writeThroughAssetBinary(path, blob);
        } catch {
          /* optional mirror */
        }
        return { href, snippet, asset: meta };
      },
  removeAsset: async (id) => {
    const victim = get().assets.find((a) => a.id === id);
    if (!victim) return;
    try {
      await deleteLibraryAsset(victim.path);
    } catch (e) {
      get().setStatus(`删除附件失败，附件已保留，可重试：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const assets = get().assets.filter((a) => a.id !== id);
    set({ assets });
    await saveAssetMetaList(assets).catch(() => undefined);
    await deleteAssetBlob(id).catch(() => undefined);
    get().setStatus("已删除附件");
    void get().refreshStorageUsage();
  },
  assetsForDoc: (docId) => {
        const doc = get().documents.find((d) => d.id === docId);
        const all = get().assets;
        if (!doc) return all.filter((a) => a.docId === docId);
        const dir = doc.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
        return all.filter(
          (a) =>
            a.docId === docId ||
            a.path.startsWith(dir ? dir + "/assets/" : "assets/") ||
            a.path.includes("/assets/")
        );
      },
  addAnnotation: (input) => {
        const ann = createAnnotation(input);
        set((s) => ({ annotations: [...s.annotations, ann] }));
        get().setStatus("已添加划线批注");
        return ann;
      },
  updateAnnotation: (id, patch) => {
        set((s) => ({
          annotations: s.annotations.map((a) => {
            if (a.id !== id) return a;
            let next = a;
            if (patch.note != null) next = updateAnnotationNote(next, patch.note);
            if (patch.color) next = { ...next, color: patch.color, updatedAt: Date.now() };
            return next;
          }),
        }));
      },
  removeAnnotation: (id) => {
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
        get().setStatus("已删除批注");
      },
  reanchorDocAnnotations: (docId, source) => {
        const prev = get().annotations;
        const matches: RematchResult[] = [];
        const annotations = prev.map((a) => {
          if (a.docId !== docId) return a;
          const norm = normalizeAnnotation(a);
          matches.push(rematchAnnotationWithAnchor(source, norm));
          return resolveAnnotation(source, norm);
        });
        const changed = annotations.some((a, i) => a !== prev[i]);
        if (changed) set({ annotations });
        const msg = formatReanchorStatus(summarizeReanchor(matches));
        if (msg) get().setStatus(msg);
      },
  persistQuizStore: async () => {
        const docs = get().quizDocs;
        try {
          await persistLearningFile(LEARNING_PATHS.quiz, { format: "langhuan-quiz", version: 1, updatedAt: Date.now(), docs });
        } catch (e) {
          get().setStatus(`练习记录写入失败，本机记录已保留，可再次保存重试：${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      },
  upsertQuizDoc: (doc) => {
        set((s) => ({ quizDocs: upsertQuizDoc(s.quizDocs, doc) }));
        void get().persistQuizStore().catch(() => {});
      },
  setQuizItemState: (docId, itemId, state) => {
        set((s) => {
          const prev = s.quizDocs.find((d) => d.docId === docId);
          if (!prev) return {};
          const next = applyQuizItemState(prev, itemId, state);
          return { quizDocs: upsertQuizDoc(s.quizDocs, next) };
        });
        void get().persistQuizStore().catch(() => {});
      },
  setQuizForce: (docId, force) => {
        set((s) => {
          const prev = s.quizDocs.find((d) => d.docId === docId);
          const now = Date.now();
          const next: QuizDoc = prev
            ? { ...prev, forceQuiz: force, updatedAt: now }
            : { docId, items: [], updatedAt: now, forceQuiz: force };
          return { quizDocs: upsertQuizDoc(s.quizDocs, next) };
        });
        void get().persistQuizStore().catch(() => {});
      },
  syncQuizForDoc: (docId) => {
        const content = get().getContent(docId);
        const prev = get().quizDocs.find((d) => d.docId === docId);
        const synced = syncQuizDocFromSource(docId, content, prev);
        if (synced) {
          set((s) => ({ quizDocs: upsertQuizDoc(s.quizDocs, synced) }));
          void get().persistQuizStore().catch(() => {});
        }
        return synced;
      },
});
