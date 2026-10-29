"use client";

import type { StateCreator } from "zustand";
import type { AssetMeta } from "../../types";
import { createAnnotation, updateAnnotationNote } from "../../annotations";
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
  | "importAssets"
  | "ingestImageFile"
  | "removeAsset"
  | "assetsForDoc"
  | "addAnnotation"
  | "updateAnnotation"
  | "removeAnnotation";

export type AssetsSlice = Pick<LanghuanState, AssetsSliceKeys>;

export const createAssetsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  AssetsSlice
> = (set, get) => ({
  assets: [],
  annotations: [],
  importAssets: async (files, opts) => {
        let m = 0;
        const docs = get().documents;
        const nextAssets = [...get().assets];
        const pathSet = new Set<string>([
          ...docs.map((d) => d.path),
          ...nextAssets.map((a) => a.path),
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
          nextAssets.push(meta);
          m += 1;

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
            get().setStatus(`附件写入 content/ 失败：${msg}`);
          }

          try {
            const { writeThroughAssetBinary } = await import("../../storage/fsSync");
            void writeThroughAssetBinary(path, blob);
          } catch {
            /* optional mirror */
          }
        }

        if (m) {
          set({ assets: nextAssets });
          void saveAssetMetaList(nextAssets);
          void get().refreshStorageUsage();
          if (!opts?.quiet) get().setStatus(`已导入 ${m} 张图片`);
        }
        return m;
      },
  ingestImageFile: async (docId, file, filename) => {
        const doc = get().documents.find((d) => d.id === docId);
        if (!doc) return null;
        const mime = (file as File).type || "image/png";
        if (!mime.startsWith("image/")) {
          get().setStatus("仅支持图片附件");
          return null;
        }
        const name =
          filename ||
          (file as File).name ||
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
        const assets = [...get().assets, meta];
        set({ assets });
        void saveAssetMetaList(assets);
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
          get().setStatus(`附件写入 content/ 失败：${msg}`);
        }
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
  removeAsset: (id) => {
        const victim = get().assets.find((a) => a.id === id);
        void deleteAssetBlob(id);
        const assets = get().assets.filter((a) => a.id !== id);
        set({ assets });
        void saveAssetMetaList(assets);
        if (victim) {
          void deleteLibraryAsset(victim.path).catch(() => {});
        }
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
});
