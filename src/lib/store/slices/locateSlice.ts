"use client";

import type { StateCreator } from "zustand";
import type { LanghuanState } from "../types";

type LocateSliceKeys =
  | "viewMode"
  | "pendingReveal"
  | "pendingPreviewLocate"
  | "treeRevealRequest"
  | "htmlScrollPercent"
  | "syncScrollByDoc"
  | "scrollSyncEvent"
  | "setViewMode"
  | "setHtmlScrollPercent"
  | "getSyncScrollEnabled"
  | "setSyncScrollEnabled"
  | "toggleSyncScroll"
  | "publishScrollSync"
  | "clearScrollSyncEvent"
  | "applyLocateResult"
  | "clearPendingReveal"
  | "requestPreviewLocate"
  | "clearPendingPreviewLocate"
  | "requestTreeReveal";

export type LocateSlice = Pick<LanghuanState, LocateSliceKeys>;

export const createLocateSlice: StateCreator<
  LanghuanState,
  [],
  [],
  LocateSlice
> = (set, get) => ({
  viewMode: "preview",
  pendingReveal: null,
  pendingPreviewLocate: null,
  treeRevealRequest: null,
  htmlScrollPercent: 0,
  syncScrollByDoc: {},
  scrollSyncEvent: null,
  setViewMode: (m) => {
        const prev = get().viewMode;
        const pending = get().pendingReveal;
        // Opening source/split with a memorized preview locate: bump nonce so
        // the (possibly already-mounted, was-hidden) editor re-applies reveal.
        if (
          pending &&
          prev === "preview" &&
          (m === "split" || m === "source")
        ) {
          set({
            viewMode: m,
            pendingReveal: { ...pending, nonce: Date.now() },
          });
          return;
        }
        set({ viewMode: m });
      },
  setHtmlScrollPercent: (n) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
        set({ htmlScrollPercent: clamped });
      },
  getSyncScrollEnabled: (docId) => {
        const v = get().syncScrollByDoc[docId];
        return v !== false;
      },
  setSyncScrollEnabled: (docId, enabled) => {
        set((s) => ({
          syncScrollByDoc: { ...s.syncScrollByDoc, [docId]: enabled },
        }));
      },
  toggleSyncScroll: (docId) => {
        const cur = get().getSyncScrollEnabled(docId);
        get().setSyncScrollEnabled(docId, !cur);
        get().setStatus(!cur ? "已开启同步滚动" : "已关闭同步滚动");
      },
  publishScrollSync: (ev) => {
        set({
          scrollSyncEvent: { ...ev, nonce: Date.now() },
        });
      },
  clearScrollSyncEvent: () => set({ scrollSyncEvent: null }),
  applyLocateResult: (result, opts) => {
        if (result.precision === "none") {
          get().setStatus(result.message);
          return;
        }
        const viewMode = get().viewMode;
        const select = opts?.select ?? false;
        const focus = opts?.focus ?? select;
        const pending = {
          start: result.start,
          end: result.end,
          nonce: Date.now(),
          select,
          focus,
          highlight: opts?.highlight ?? true,
          center: opts?.center ?? true,
        };
        // Explicit 「定位源码」(select/focus): open split immediately so editors
        // mount/reveal. Plain preview remember (no select) still waits for 源码/分栏.
        // 框选 alone never calls this with select — only context menu / shortcuts.
        if (viewMode === "preview") {
          if (select || focus) {
            set({
              viewMode: "split",
              htmlImmersive: false,
              pendingReveal: pending,
              status: { message: result.message, at: Date.now() },
            });
            return;
          }
          set({
            pendingReveal: pending,
            status: {
              message: "已记住位置，点「源码」或「分栏」可查看",
              at: Date.now(),
            },
          });
          return;
        }
        set({
          pendingReveal: pending,
          status: { message: result.message, at: Date.now() },
        });
      },
  clearPendingReveal: () => set({ pendingReveal: null }),
  requestPreviewLocate: (offset, opts) => {
        set({
          pendingPreviewLocate: {
            offset,
            nonce: Date.now(),
            scroll: opts?.scroll === true,
            announce: opts?.announce === true,
          },
        });
      },
  clearPendingPreviewLocate: () => set({ pendingPreviewLocate: null }),
  requestTreeReveal: (docId) => {
        if (!docId) return;
        set({
          treeRevealRequest: { docId, nonce: Date.now() },
          sidebarPanel: "docs",
          sidebarOpen: true,
        });
      },
});
