"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssetMeta, Document, TrashItem } from "../types";
import type { ShortcutMap } from "../shortcuts";
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from "../shortcuts";
import type { ReadingPrefs } from "../readingPrefs";
import { DEFAULT_READING_PREFS, normalizeReadingPrefs } from "../readingPrefs";
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  normalizeTheme,
} from "../theme";
import { idbJSONStorage, STORE_KEY } from "../storage/idbPersist";
import { stashIdbLibrary } from "../storage/contentMigration";
import { pruneEmptyFolders } from "../folders";
import type { LanghuanState } from "./types";
import { filteredDocuments } from "./helpers/filteredDocuments";
import { createUiSlice } from "./slices/uiSlice";
import { createLocateSlice } from "./slices/locateSlice";
import { createSearchMetaSlice } from "./slices/searchMetaSlice";
import { createTrashSlice } from "./slices/trashSlice";
import { createTabsSlice } from "./slices/tabsSlice";
import { createAssetsSlice } from "./slices/assetsSlice";
import { createSyncBackupSlice } from "./slices/syncBackupSlice";
import { createDocsSlice } from "./slices/docsSlice";

export type {
  PendingReveal,
  SyncScrollPrefs,
  ScrollSyncEvent,
  PreviewLocateOpts,
  PendingPreviewLocate,
  TreeRevealRequest,
} from "./types";

export { filteredDocuments };

export const useStore = create<LanghuanState>()(
  persist(
    (...a) => ({
      ...createUiSlice(...a),
      ...createLocateSlice(...a),
      ...createSearchMetaSlice(...a),
      ...createTrashSlice(...a),
      ...createTabsSlice(...a),
      ...createAssetsSlice(...a),
      ...createSyncBackupSlice(...a),
      ...createDocsSlice(...a),
    }),
    {
      name: STORE_KEY,
      storage: idbJSONStorage,
      partialize: (s) => ({
        // documents / trash / assets live in content/ — IDB keeps UI prefs only
        drafts: s.drafts,
        emptyFolders: s.emptyFolders,
        theme: s.theme,
        viewMode: s.viewMode,
        activeId: s.activeId,
        splitRatio: s.splitRatio,
        splitSourceFirst: s.splitSourceFirst,
        syncScrollByDoc: s.syncScrollByDoc,
        sidebarWidth: s.sidebarWidth,
        outlineWidth: s.outlineWidth,
        outlineRailOpen: s.outlineRailOpen,
        tagFilters: s.tagFilters,
        htmlPreviewPrefs: s.htmlPreviewPrefs,
        lastBackupAt: s.lastBackupAt,
        autosaveEnabled: s.autosaveEnabled,
        fsBoundName: s.fsBoundName,
        fsLastSyncAt: s.fsLastSyncAt,
        savedSearches: s.savedSearches,
        statusFilter: s.statusFilter,
        annotations: s.annotations,
        quizDocs: s.quizDocs,
        readingPrefs: s.readingPrefs,
        mdFocusMode: s.mdFocusMode,
        openTabs: s.openTabs,
        pinnedTabs: s.pinnedTabs,
        secondaryId: s.secondaryId,
        docSplitRatio: s.docSplitRatio,
        customShortcuts: s.customShortcuts,
      }),
      version: 9,
      migrate: (persisted, fromVersion) => {
        const p = (persisted || {}) as Record<string, unknown>;
        if (fromVersion < 9) {
          stashIdbLibrary({
            documents: Array.isArray(p.documents) ? (p.documents as Document[]) : [],
            assets: Array.isArray(p.assets) ? (p.assets as AssetMeta[]) : [],
            trash: Array.isArray(p.trash) ? (p.trash as TrashItem[]) : [],
          });
          // Stop carrying library bodies in the persisted blob
          delete p.documents;
          delete p.assets;
          delete p.trash;
        }
        if (Array.isArray(p.tagFilters)) {
          p.tagFilters = [...new Set((p.tagFilters as unknown[]).map(String).filter(Boolean))];
        } else if (typeof p.tagFilter === "string" && p.tagFilter) {
          p.tagFilters = [p.tagFilter];
        } else if (!Array.isArray(p.tagFilters)) {
          p.tagFilters = [];
        }
        delete p.tagFilter;
        if (!Array.isArray(p.trash)) p.trash = [];
        if (!Array.isArray(p.emptyFolders)) p.emptyFolders = [];
        else {
          p.emptyFolders = pruneEmptyFolders(
            (p.emptyFolders as string[]).map(String),
            Array.isArray(p.documents)
              ? (p.documents as { path?: string }[]).map((d) => String(d?.path || ""))
              : []
          );
        }
        if (typeof p.autosaveEnabled !== "boolean") p.autosaveEnabled = true;
        if (p.lastBackupAt != null && typeof p.lastBackupAt !== "number") p.lastBackupAt = null;
        if (p.fsBoundName != null && typeof p.fsBoundName !== "string") p.fsBoundName = null;
        if (p.fsLastSyncAt != null && typeof p.fsLastSyncAt !== "number") p.fsLastSyncAt = null;
        if (!("fsBoundName" in p)) p.fsBoundName = null;
        if (!("fsLastSyncAt" in p)) p.fsLastSyncAt = null;
        if (!Array.isArray(p.savedSearches)) p.savedSearches = [];
        if (!("statusFilter" in p)) p.statusFilter = null;
        if (!Array.isArray(p.assets)) p.assets = [];
        if (!Array.isArray(p.annotations)) p.annotations = [];
        if (!Array.isArray(p.quizDocs)) p.quizDocs = [];
        p.readingPrefs = normalizeReadingPrefs(
          (p.readingPrefs as Partial<ReadingPrefs>) || DEFAULT_READING_PREFS
        );
        if (typeof p.mdFocusMode !== "boolean") {
          p.mdFocusMode = !!(p.readingPrefs as ReadingPrefs).focusMode;
        }
        if (!Array.isArray(p.openTabs)) p.openTabs = [];
        if (!Array.isArray(p.pinnedTabs)) p.pinnedTabs = [];
        if (!("secondaryId" in p)) p.secondaryId = null;
        if (typeof p.docSplitRatio !== "number") p.docSplitRatio = 0.5;
        if (!p.syncScrollByDoc || typeof p.syncScrollByDoc !== "object") p.syncScrollByDoc = {};
        p.customShortcuts = normalizeShortcuts(
          (p.customShortcuts as Partial<ShortcutMap>) || {}
        );
        // store only overrides; strip identical defaults later on read
        {
          const full = p.customShortcuts as ShortcutMap;
          const overrides: Partial<ShortcutMap> = {};
          (Object.keys(DEFAULT_SHORTCUTS) as (keyof ShortcutMap)[]).forEach((k) => {
            if (full[k] && full[k] !== DEFAULT_SHORTCUTS[k]) overrides[k] = full[k];
          });
          p.customShortcuts = overrides;
        }
        // N-langhuan-themes-5: paper→xuan, ink→songyan
        p.theme = normalizeTheme(p.theme);
        void fromVersion;
        return p as typeof persisted;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state?.theme && typeof document !== "undefined") {
          const id = normalizeTheme(state.theme);
          if (id !== state.theme) state.theme = id;
          applyThemeToDocument(id);
          try {
            localStorage.setItem(THEME_STORAGE_KEY, id);
          } catch {
            /* ignore */
          }
        }
        if (state) {
          if (typeof state.sidebarWidth === "number") {
            state.setSidebarWidth(state.sidebarWidth);
          }
          if (typeof state.outlineRailOpen !== "boolean") {
            state.setOutlineRailOpen(true);
          }
          void state.hydrateFromContent().then(() => {
            const purged = state.purgeExpiredTrash();
            if (purged > 0) {
              state.setStatus(`已自动清理 ${purged} 篇过期回收站文档`);
            }
            void state.refreshStorageUsage();
          });
        }
      },
    }
  )
);
