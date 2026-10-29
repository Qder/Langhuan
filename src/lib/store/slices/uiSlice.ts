"use client";

import type { StateCreator } from "zustand";
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  nextTheme,
  normalizeTheme,
  themeLabel,
} from "../../theme";
import { DEFAULT_READING_PREFS, normalizeReadingPrefs } from "../../readingPrefs";
import { DEFAULT_HTML_PREVIEW_PREFS, normalizeHtmlPrefs } from "../../htmlPreviewPrefs";
import type { LanghuanState } from "../types";

type UiSliceKeys =
  | "hydrated"
  | "theme"
  | "sidebarOpen"
  | "commandOpen"
  | "status"
  | "splitRatio"
  | "splitSourceFirst"
  | "sidebarWidth"
  | "outlineWidth"
  | "outlineRailOpen"
  | "sidebarPanel"
  | "htmlImmersive"
  | "htmlSidebarPeek"
  | "htmlPreviewPrefs"
  | "htmlReloadToken"
  | "editorCaret"
  | "readingPrefs"
  | "mdFocusMode"
  | "customShortcuts"
  | "exportDialogOpen"
  | "shortcutsDialogOpen"
  | "backupDialogOpen"
  | "versionDialogOpen"
  | "graphDialogOpen"
  | "propsDialogOpen"
  | "clipUrlDialogOpen"
  | "templateDialogOpen"
  | "quizReviewOpen"
  | "linkHealthOpen"
  | "findReplaceOpen"
  | "pendingQuizReveal"
  | "fsSyncDialogOpen"
  | "autosaveEnabled"
  | "lastBackupAt"
  | "fsBoundName"
  | "fsLastSyncAt"
  | "setHydrated"
  | "setTheme"
  | "toggleTheme"
  | "setSidebarOpen"
  | "setCommandOpen"
  | "setSplitRatio"
  | "setSplitSourceFirst"
  | "toggleSplitSourceFirst"
  | "setSidebarWidth"
  | "setOutlineWidth"
  | "setOutlineRailOpen"
  | "toggleOutlineRail"
  | "setSidebarPanel"
  | "setHtmlImmersive"
  | "toggleHtmlImmersive"
  | "setHtmlSidebarPeek"
  | "getHtmlPreviewPrefs"
  | "setHtmlPreviewPrefs"
  | "bumpHtmlReload"
  | "setStatus"
  | "setEditorCaret"
  | "setReadingPrefs"
  | "setMdFocusMode"
  | "toggleMdFocusMode"
  | "setCustomShortcuts"
  | "resetCustomShortcuts"
  | "setExportDialogOpen"
  | "setShortcutsDialogOpen"
  | "setBackupDialogOpen"
  | "setVersionDialogOpen"
  | "setGraphDialogOpen"
  | "setPropsDialogOpen"
  | "setClipUrlDialogOpen"
  | "setTemplateDialogOpen"
  | "setQuizReviewOpen"
  | "setLinkHealthOpen"
  | "setFindReplaceOpen"
  | "setPendingQuizReveal"
  | "setFsSyncDialogOpen"
  | "setAutosaveEnabled"
  | "setLastBackupAt"
  | "setFsBoundName"
  | "setFsLastSyncAt";

export type UiSlice = Pick<LanghuanState, UiSliceKeys>;

export const createUiSlice: StateCreator<
  LanghuanState,
  [],
  [],
  UiSlice
> = (set, get) => ({
  hydrated: false,
  theme: "xuan",
  sidebarOpen: false,
  commandOpen: false,
  status: null,
  splitRatio: 0.5,
  splitSourceFirst: true,
  sidebarWidth: 280,
  outlineWidth: 240,
  outlineRailOpen: true,
  sidebarPanel: "docs",
  htmlImmersive: false,
  htmlSidebarPeek: false,
  htmlPreviewPrefs: {},
  htmlReloadToken: 0,
  editorCaret: null,
  readingPrefs: { ...DEFAULT_READING_PREFS },
  mdFocusMode: false,
  customShortcuts: {},
  exportDialogOpen: false,
  shortcutsDialogOpen: false,
  backupDialogOpen: false,
  versionDialogOpen: false,
  graphDialogOpen: false,
  propsDialogOpen: false,
  clipUrlDialogOpen: false,
  templateDialogOpen: false,
  quizReviewOpen: false,
  linkHealthOpen: false,
  findReplaceOpen: false,
  pendingQuizReveal: null,
  fsSyncDialogOpen: false,
  autosaveEnabled: true,
  lastBackupAt: null,
  fsBoundName: null,
  fsLastSyncAt: null,
  setHydrated: (v) => set({ hydrated: v }),
  setTheme: (t) => {
        const id = normalizeTheme(t);
        set({ theme: id });
        applyThemeToDocument(id);
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(THEME_STORAGE_KEY, id);
          }
        } catch {
          /* ignore */
        }
      },
  toggleTheme: () => {
        const next = nextTheme(get().theme);
        get().setTheme(next);
        get().setStatus(`已切换到${themeLabel(next)}`);
      },
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),
  setSplitRatio: (r) => {
        const clamped = Math.min(0.8, Math.max(0.2, r));
        set({ splitRatio: clamped });
      },
  setSplitSourceFirst: (v) => set({ splitSourceFirst: v }),
  toggleSplitSourceFirst: () => {
        const next = !get().splitSourceFirst;
        set({ splitSourceFirst: next });
        get().setStatus(next ? "分栏：源码在左" : "分栏：预览在左");
      },
  setSidebarWidth: (w) => {
        const clamped = Math.min(360, Math.max(240, Math.round(w)));
        set({ sidebarWidth: clamped });
      },
  setOutlineWidth: (w) => {
        const clamped = Math.min(360, Math.max(160, Math.round(w)));
        set({ outlineWidth: clamped });
      },
  setOutlineRailOpen: (v) => set({ outlineRailOpen: v }),
  toggleOutlineRail: () => {
        const next = !get().outlineRailOpen;
        set({ outlineRailOpen: next });
        get().setStatus(next ? "已显示大纲栏" : "已隐藏大纲栏");
      },
  setSidebarPanel: (p) => set({ sidebarPanel: p }),
  setHtmlImmersive: (v) =>
        set({
          htmlImmersive: v,
          htmlSidebarPeek: v ? false : get().htmlSidebarPeek,
        }),
  toggleHtmlImmersive: () => {
        const next = !get().htmlImmersive;
        get().setHtmlImmersive(next);
        get().setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
      },
  setHtmlSidebarPeek: (v) => set({ htmlSidebarPeek: v }),
  getHtmlPreviewPrefs: (id) =>
        normalizeHtmlPrefs(get().htmlPreviewPrefs[id] || DEFAULT_HTML_PREVIEW_PREFS),
  setHtmlPreviewPrefs: (id, patch) => {
        const cur = normalizeHtmlPrefs(get().htmlPreviewPrefs[id]);
        const next = normalizeHtmlPrefs({ ...cur, ...patch });
        set((s) => ({
          htmlPreviewPrefs: { ...s.htmlPreviewPrefs, [id]: next },
        }));
      },
  bumpHtmlReload: () => set((s) => ({ htmlReloadToken: s.htmlReloadToken + 1 })),
  setStatus: (message) => set({ status: { message, at: Date.now() } }),
  setEditorCaret: (c) => set({ editorCaret: c }),
  setReadingPrefs: (patch) => {
        const next = normalizeReadingPrefs({ ...get().readingPrefs, ...patch });
        set({
          readingPrefs: next,
          mdFocusMode: next.focusMode,
        });
      },
  setMdFocusMode: (v) => {
        set({
          mdFocusMode: v,
          readingPrefs: { ...get().readingPrefs, focusMode: v },
        });
      },
  toggleMdFocusMode: () => {
        const next = !get().mdFocusMode;
        get().setMdFocusMode(next);
        get().setStatus(next ? "已进入专注模式" : "已退出专注模式");
      },
  setCustomShortcuts: (patch) => {
        set((s) => ({
          customShortcuts: { ...s.customShortcuts, ...patch },
        }));
        get().setStatus("已更新快捷键");
      },
  resetCustomShortcuts: () => {
        set({ customShortcuts: {} });
        get().setStatus("已恢复默认快捷键");
      },
  setExportDialogOpen: (v) => set({ exportDialogOpen: v }),
  setShortcutsDialogOpen: (v) => set({ shortcutsDialogOpen: v }),
  setBackupDialogOpen: (v) => set({ backupDialogOpen: v }),
  setVersionDialogOpen: (v) => set({ versionDialogOpen: v }),
  setGraphDialogOpen: (v) => set({ graphDialogOpen: v }),
  setPropsDialogOpen: (v) => set({ propsDialogOpen: v }),
  setClipUrlDialogOpen: (v) => set({ clipUrlDialogOpen: v }),
  setTemplateDialogOpen: (v) => set({ templateDialogOpen: v }),
  setQuizReviewOpen: (v) => set({ quizReviewOpen: v }),
  setLinkHealthOpen: (v) => set({ linkHealthOpen: v }),
  setFindReplaceOpen: (v) => set({ findReplaceOpen: v }),
  setPendingQuizReveal: (v) => set({ pendingQuizReveal: v }),
  setFsSyncDialogOpen: (v) => set({ fsSyncDialogOpen: v }),
  setAutosaveEnabled: (v) => {
        set({ autosaveEnabled: v });
        get().setStatus(v ? "已开启自动保存" : "已关闭自动保存");
      },
  setLastBackupAt: (t) => set({ lastBackupAt: t }),
  setFsBoundName: (name) => set({ fsBoundName: name }),
  setFsLastSyncAt: (t) => set({ fsLastSyncAt: t }),
});
