"use client";

import type { StateCreator } from "zustand";
import type { TrashItem } from "../../types";
import { basename } from "../../utils";
import { clearVersions } from "../../storage/versions";
import { TRASH_RETENTION_DAYS } from "../../storage/constants";
import { deleteLibraryDoc, purgeLibraryTrash, restoreLibraryTrash } from "../../storage/contentApi";
import {
  isPathUnderFolder,
  normalizeFolderPath,
  removeFolderAndDescendants,
} from "../../folders";
import { forgetScrollMemory } from "../../scrollMemory";
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
  deleteDoc: async (id) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return false;
    // Persist unsaved content first so trash contains the user's latest text.
    const content = get().getContent(id);
    const saved = await get().saveDocNow(id, { force: true });
    if (!saved.ok) return false;
    if (get().getContent(id) !== content || get().documents.find((d) => d.id === id)?.path !== doc.path) {
      get().setStatus("删除前又有新修改，请重试删除");
      return false;
    }
    try {
      await deleteLibraryDoc(doc.path, "trash");
    } catch (e) {
      get().setStatus(`删除失败，笔记与草稿已保留：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    const savedDoc = get().documents.find((d) => d.id === id) ?? doc;
    const changed = get().getContent(id) !== content || savedDoc.path !== doc.path;
    const item: TrashItem = { doc: { ...doc, content }, deletedAt: Date.now() };
    set((s) => ({
      documents: changed ? s.documents : s.documents.filter((d) => d.id !== id),
      drafts: changed ? { ...s.drafts, [id]: s.drafts[id] ?? savedDoc.content } : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
      trash: [item, ...s.trash.filter((t) => t.doc.id !== id)],
      openTabs: changed ? s.openTabs : s.openTabs.filter((t) => t !== id),
      pinnedTabs: changed ? s.pinnedTabs : s.pinnedTabs.filter((t) => t !== id),
      treeSelection: s.treeSelection.filter((t) => t !== id),
      activeId: !changed && s.activeId === id ? s.openTabs.find((t) => t !== id) ?? null : s.activeId,
      secondaryId: !changed && s.secondaryId === id ? null : s.secondaryId,
    }));
    if (!changed) forgetScrollMemory(doc.path);
    get().setStatus(changed ? "旧内容已移入回收站，新修改仍保留为草稿，请保存" : `已移入回收站 ${basename(doc.path)}`);
    void get().refreshStorageUsage();
    return !changed;
  },
  deleteFolder: async (folderPath) => {
    const folder = normalizeFolderPath(folderPath);
    if (!folder) { get().setStatus("不能删除库根目录"); return 0; }
    const victims = get().documents.filter((d) => isPathUnderFolder(d.path, folder));
    let deleted = 0;
    for (const doc of victims) if (await get().deleteDoc(doc.id)) deleted++;
    if (deleted === victims.length) {
      set((s) => ({ emptyFolders: removeFolderAndDescendants(s.emptyFolders, folder) }));
    }
    get().setStatus(deleted === victims.length
      ? `已删除文件夹 ${folder}（${deleted} 篇移入回收站）`
      : `文件夹部分删除：${deleted}/${victims.length} 篇，失败笔记与草稿已保留，可重试`);
    return deleted;
  },
  restoreFromTrash: async (id) => {
    if (!get().trash.some((t) => t.doc.id === id)) return;
    try {
      const restored = await restoreLibraryTrash(id);
      set((s) => ({
        trash: s.trash.filter((t) => t.doc.id !== id),
        documents: [...s.documents.filter((d) => d.id !== restored.id), restored],
      }));
      get().setStatus(`已恢复 ${restored.path}`);
    } catch (e) {
      // Do not remove trash, or fall back to overwriting a guessed path.
      get().setStatus(`恢复失败，回收站数据已保留，可重试：${e instanceof Error ? e.message : String(e)}`);
    }
    void get().refreshStorageUsage();
  },
  purgeTrashItem: async (id) => {
    const item = get().trash.find((t) => t.doc.id === id);
    try {
      await purgeLibraryTrash(id);
      set((s) => ({ trash: s.trash.filter((t) => t.doc.id !== id) }));
      if (item) await clearVersions(item.doc.id);
      get().setStatus("已彻底删除");
    } catch (e) {
      get().setStatus(`彻底删除失败，可重试：${e instanceof Error ? e.message : String(e)}`);
    }
    void get().refreshStorageUsage();
  },
  emptyTrash: async () => {
    for (const item of [...get().trash]) await get().purgeTrashItem(item.doc.id);
  },
  purgeExpiredTrash: () => {
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expired = (get().trash ?? []).filter((t) => t.deletedAt < cutoff);
    for (const item of expired) void get().purgeTrashItem(item.doc.id);
    // Completion is asynchronous; do not report an unconfirmed purge count.
    return 0;
  },
});
