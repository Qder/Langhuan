"use client";

import type { StateCreator } from "zustand";
import type { FocusedPane } from "../../types";
import { basename } from "../../utils";
import { getTags } from "../../tags";
import { nextActiveAfterClose, tabsToClose } from "../../tabClose";
import type { LanghuanState } from "../types";

type TabsSliceKeys =
  | "openTabs"
  | "pinnedTabs"
  | "secondaryId"
  | "focusedPane"
  | "docSplitRatio"
  | "treeSelection"
  | "batchMode"
  | "openTab"
  | "closeTab"
  | "closeTabsInMode"
  | "togglePinTab"
  | "reorderTabs"
  | "setSecondaryId"
  | "setFocusedPane"
  | "setDocSplitRatio"
  | "openInSplit"
  | "toggleDocSplit"
  | "setTreeSelection"
  | "toggleTreeSelected"
  | "clearTreeSelection"
  | "setBatchMode"
  | "moveDocsToFolder"
  | "batchDelete"
  | "batchSetTags";

export type TabsSlice = Pick<LanghuanState, TabsSliceKeys>;

export const createTabsSlice: StateCreator<
  LanghuanState,
  [],
  [],
  TabsSlice
> = (set, get) => ({
  openTabs: [],
  pinnedTabs: [],
  secondaryId: null,
  focusedPane: "primary",
  docSplitRatio: 0.5,
  treeSelection: [],
  batchMode: false,
  openTab: (id) => {
        if (!get().documents.some((d) => d.id === id)) return;
        set((s) => ({
          openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
          activeId: id,
          focusedPane: "primary",
        }));
      },
  closeTab: (id) => {
        const { openTabs, pinnedTabs, activeId, secondaryId } = get();
        if (pinnedTabs.includes(id)) {
          get().setStatus("已固定的标签请先取消固定");
          return;
        }
        const next = openTabs.filter((t) => t !== id);
        let newActive = activeId;
        if (activeId === id) {
          const idx = openTabs.indexOf(id);
          newActive = next[Math.min(idx, next.length - 1)] || next[0] || null;
        }
        set({
          openTabs: next,
          activeId: newActive,
          secondaryId: secondaryId === id ? null : secondaryId,
        });
      },
  closeTabsInMode: (targetId, mode) => {
        const { openTabs, pinnedTabs, activeId, secondaryId } = get();
        if (!openTabs.includes(targetId)) return;
        const ids = tabsToClose(openTabs, pinnedTabs, targetId, mode);
        if (!ids.length) return;
        const closed = new Set(ids);
        const next = openTabs.filter((t) => !closed.has(t));
        const newActive = nextActiveAfterClose(openTabs, activeId, closed);
        set({
          openTabs: next,
          activeId: newActive,
          secondaryId: secondaryId && closed.has(secondaryId) ? null : secondaryId,
        });
      },
  togglePinTab: (id) => {
        set((s) => ({
          pinnedTabs: s.pinnedTabs.includes(id)
            ? s.pinnedTabs.filter((t) => t !== id)
            : [...s.pinnedTabs, id],
          openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
        }));
      },
  reorderTabs: (from, to) => {
        set((s) => {
          if (from < 0 || to < 0 || from >= s.openTabs.length || to >= s.openTabs.length) return s;
          const next = [...s.openTabs];
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          return { openTabs: next };
        });
      },
  setSecondaryId: (id) => set({ secondaryId: id }),
  setFocusedPane: (p) => set({ focusedPane: p }),
  setDocSplitRatio: (r) => {
        const clamped = Math.min(0.8, Math.max(0.2, r));
        set({ docSplitRatio: clamped });
      },
  openInSplit: (id) => {
        if (!get().documents.some((d) => d.id === id)) return;
        const cur = get().activeId;
        set((s) => {
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id];
          if (!cur || cur === id) {
            return { openTabs, secondaryId: id, focusedPane: "secondary" as FocusedPane };
          }
          return {
            openTabs,
            secondaryId: id,
            focusedPane: "secondary" as FocusedPane,
          };
        });
        get().setStatus("已在分屏打开");
      },
  toggleDocSplit: () => {
        const { secondaryId, activeId, openTabs } = get();
        if (secondaryId) {
          set({ secondaryId: null, focusedPane: "primary" });
          get().setStatus("已关闭文档分屏");
          return;
        }
        const other = openTabs.find((t) => t !== activeId) || null;
        if (!other) {
          get().setStatus("请先打开另一篇文档，或从侧栏「分屏打开」");
          return;
        }
        set({ secondaryId: other, focusedPane: "secondary" });
        get().setStatus("已开启文档分屏");
      },
  setTreeSelection: (ids) => set({ treeSelection: [...new Set(ids)] }),
  toggleTreeSelected: (id) => {
        set((s) => ({
          treeSelection: s.treeSelection.includes(id)
            ? s.treeSelection.filter((x) => x !== id)
            : [...s.treeSelection, id],
        }));
      },
  clearTreeSelection: () => set({ treeSelection: [] }),
  setBatchMode: (v) =>
        set({ batchMode: v, treeSelection: v ? get().treeSelection : [] }),
  moveDocsToFolder: (ids, folderPath) => {
        const folder = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        let n = 0;
        for (const id of ids) {
          const doc = get().documents.find((d) => d.id === id);
          if (!doc) continue;
          const name = basename(doc.path);
          const nextPath = folder ? `${folder}/${name}` : name;
          if (nextPath === doc.path) continue;
          get().renameDoc(id, nextPath);
          n += 1;
        }
        if (n) get().setStatus(`已移动 ${n} 篇到 ${folder || "根目录"}`);
        get().clearTreeSelection();
        return n;
      },
  batchDelete: (ids) => {
        let n = 0;
        for (const id of [...ids]) {
          if (get().documents.some((d) => d.id === id)) {
            get().deleteDoc(id);
            n += 1;
          }
        }
        get().clearTreeSelection();
        if (n) get().setStatus(`已将 ${n} 篇移入回收站`);
        return n;
      },
  batchSetTags: (ids, tags, mode) => {
        const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
        let n = 0;
        for (const id of ids) {
          const doc = get().documents.find((d) => d.id === id);
          if (!doc) continue;
          const cur = getTags(doc);
          const next =
            mode === "replace" ? clean : [...new Set([...cur, ...clean])];
          get().setDocTags(id, next);
          n += 1;
        }
        if (n) get().setStatus(`已为 ${n} 篇更新标签`);
        return n;
      },
});
