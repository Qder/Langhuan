"use client";

import type { StateCreator } from "zustand";
import type { Document, TrashItem } from "../../types";
import { basename } from "../../utils";
import { clearVersions } from "../../storage/versions";
import { TRASH_RETENTION_DAYS } from "../../storage/constants";
import { deleteLibraryDoc, purgeLibraryTrash, restoreLibraryTrash } from "../../storage/contentApi";
import {
  isPathUnderFolder,
  normalizeFolderPath,
  removeFolderAndDescendants,
} from "../../folders";
import { ensureUniquePath } from "../helpers/paths";
import { scheduleContentPersist } from "../helpers/persistSchedule";
import type { LanghuanState } from "../types";

type TrashSliceKeys =
  | "trash"
  | "deleteDoc"
  | "deleteFolder"
  | "restoreFromTrash"
  | "purgeTrashItem"
  | "emptyTrash"
  | "purgeExpiredTrash";

export type TrashSlice = Pick<LanghuanState, TrashSliceKeys>;

export const createTrashSlice: StateCreator<
  LanghuanState,
  [],
  [],
  TrashSlice
> = (set, get) => ({
  trash: [],
  deleteDoc: (id) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const item: TrashItem = { doc, deletedAt: Date.now() };
        set((s) => {
          const openTabs = s.openTabs.filter((t) => t !== id);
          const pinnedTabs = s.pinnedTabs.filter((t) => t !== id);
          const treeSelection = s.treeSelection.filter((t) => t !== id);
          let activeId = s.activeId === id ? null : s.activeId;
          if (s.activeId === id) {
            const idx = s.openTabs.indexOf(id);
            const fallback = openTabs[Math.min(idx, openTabs.length - 1)] || openTabs[0] || null;
            activeId = fallback;
          }
          return {
            documents: s.documents.filter((d) => d.id !== id),
            drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
            trash: [item, ...s.trash.filter((t) => t.doc.id !== id)],
            activeId,
            openTabs,
            pinnedTabs,
            treeSelection,
            secondaryId: s.secondaryId === id ? null : s.secondaryId,
          };
        });
        get().setStatus(`已移入回收站 ${basename(doc.path)}`);
        void deleteLibraryDoc(doc.path, "trash").catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          get().setStatus(`回收站同步失败：${msg}`);
        });
        void get().refreshStorageUsage();
      },
  deleteFolder: (folderPath) => {
        const folder = normalizeFolderPath(folderPath);
        if (!folder) {
          get().setStatus("不能删除库根目录");
          return 0;
        }
        const victims = get().documents.filter((d) =>
          isPathUnderFolder(d.path, folder)
        );
        const now = Date.now();
        const trashItems: TrashItem[] = victims.map((doc) => ({
          doc,
          deletedAt: now,
        }));
        const victimIds = new Set(victims.map((d) => d.id));

        set((s) => {
          const openTabs = s.openTabs.filter((t) => !victimIds.has(t));
          const pinnedTabs = s.pinnedTabs.filter((t) => !victimIds.has(t));
          const treeSelection = s.treeSelection.filter((t) => !victimIds.has(t));
          let activeId =
            s.activeId && victimIds.has(s.activeId) ? null : s.activeId;
          if (s.activeId && victimIds.has(s.activeId)) {
            const idx = s.openTabs.indexOf(s.activeId);
            const fallback =
              openTabs[Math.min(idx, openTabs.length - 1)] ||
              openTabs[0] ||
              null;
            activeId = fallback;
          }
          return {
            documents: s.documents.filter((d) => !victimIds.has(d.id)),
            drafts: Object.fromEntries(
              Object.entries(s.drafts).filter(([k]) => !victimIds.has(k))
            ),
            trash: [
              ...trashItems,
              ...s.trash.filter((t) => !victimIds.has(t.doc.id)),
            ],
            emptyFolders: removeFolderAndDescendants(s.emptyFolders, folder),
            activeId,
            openTabs,
            pinnedTabs,
            treeSelection,
            secondaryId:
              s.secondaryId && victimIds.has(s.secondaryId)
                ? null
                : s.secondaryId,
          };
        });

        const n = victims.length;
        get().setStatus(
          n
            ? `已删除文件夹 ${folder}（${n} 篇移入回收站）`
            : `已删除空文件夹 ${folder}`
        );
        for (const v of victims) {
          void deleteLibraryDoc(v.path, "trash").catch(() => {
            /* best-effort */
          });
        }
        void get().refreshStorageUsage();
        return n;
      },
  restoreFromTrash: (id) => {
        const item = get().trash.find((t) => t.doc.id === id);
        if (!item) return;
        let path = item.doc.path;
        path = ensureUniquePath(path, get().documents);
        const restored: Document = {
          ...item.doc,
          path,
          updatedAt: Date.now(),
        };
        set((s) => ({
          trash: s.trash.filter((t) => t.doc.id !== id),
          documents: [...s.documents, restored],
        }));
        get().setStatus(`已恢复 ${basename(restored.path)}`);
        void restoreLibraryTrash(id)
          .then((doc) => {
            if (doc.path !== restored.path) {
              set((s) => ({
                documents: s.documents.map((d) => (d.id === id ? { ...d, path: doc.path } : d)),
              }));
            }
          })
          .catch(() => {
            // Fallback: write restored doc directly
            scheduleContentPersist(get, set, restored);
          });
        void get().refreshStorageUsage();
      },
  purgeTrashItem: (id) => {
        const item = get().trash.find((t) => t.doc.id === id);
        set((s) => ({ trash: s.trash.filter((t) => t.doc.id !== id) }));
        if (item) void clearVersions(item.doc.id);
        get().setStatus(item ? `已彻底删除 ${basename(item.doc.path)}` : "已彻底删除");
        void purgeLibraryTrash(id).catch(() => {
          /* best-effort */
        });
        void get().refreshStorageUsage();
      },
  emptyTrash: () => {
        const ids = get().trash.map((t) => t.doc.id);
        set({ trash: [] });
        for (const id of ids) {
          void clearVersions(id);
          void purgeLibraryTrash(id).catch(() => {
            /* best-effort */
          });
        }
        get().setStatus("回收站已清空");
        void get().refreshStorageUsage();
      },
  purgeExpiredTrash: () => {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const expired = get().trash.filter((t) => t.deletedAt < cutoff);
        if (!expired.length) return 0;
        const keep = get().trash.filter((t) => t.deletedAt >= cutoff);
        set({ trash: keep });
        for (const t of expired) {
          void clearVersions(t.doc.id);
          void purgeLibraryTrash(t.doc.id).catch(() => {
            /* best-effort */
          });
        }
        void get().refreshStorageUsage();
        return expired.length;
      },
});
