"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Document, StatusFeedback, ThemeMode, ViewMode } from "./types";
import type { LocateResult } from "./locate/types";

export type PendingReveal = {
  start: number;
  end: number;
  nonce: number;
};

export type PendingPreviewLocate = {
  offset: number;
  nonce: number;
};
import { createSeedDocuments } from "./seed";
import { isImportableLibraryPath, libraryDocTypeFromPath, normalizeImportedPath } from "./importable";
import { getTags, setHtmlTags, setMdTags } from "./tags";
import { basename, uniquePath, uid } from "./utils";

type LanghuanState = {
  hydrated: boolean;
  documents: Document[];
  drafts: Record<string, string>;
  activeId: string | null;
  viewMode: ViewMode;
  theme: ThemeMode;
  tagFilter: string | null;
  sidebarOpen: boolean;
  commandOpen: boolean;
  status: StatusFeedback;
  pendingReveal: PendingReveal | null;
  pendingPreviewLocate: PendingPreviewLocate | null;
  /** Fraction of split space for the source pane (0.2–0.8). */
  splitRatio: number;
  /** When true, source is on the left (or top on small screens). */
  splitSourceFirst: boolean;
  /** Desktop sidebar width in px (240–360). */
  sidebarWidth: number;
  /** Markdown outline/backlinks panel width in px (160–360). */
  outlineWidth: number;
  /** Whether the MD outline/backlinks rail is preferred open (persisted). */
  outlineRailOpen: boolean;
  /** Sidebar middle panel: docs tree | tags | starred. */
  sidebarPanel: "docs" | "tags" | "stars";
  setHydrated: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setTagFilter: (t: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setSplitRatio: (r: number) => void;
  setSplitSourceFirst: (v: boolean) => void;
  toggleSplitSourceFirst: () => void;
  setSidebarWidth: (w: number) => void;
  setOutlineWidth: (w: number) => void;
  setOutlineRailOpen: (v: boolean) => void;
  toggleOutlineRail: () => void;
  setSidebarPanel: (p: "docs" | "tags" | "stars") => void;
  setStatus: (message: string) => void;
  applyLocateResult: (result: LocateResult) => void;
  clearPendingReveal: () => void;
  requestPreviewLocate: (offset: number) => void;
  clearPendingPreviewLocate: () => void;
  openHome: () => void;
  openDoc: (id: string) => void;
  getActive: () => Document | null;
  getContent: (id: string) => string;
  isDirty: (id: string) => boolean;
  setDraft: (id: string, content: string) => void;
  saveDoc: (id?: string) => void;
  discardDraft: (id?: string) => void;
  createDoc: (opts: { type: Document["type"]; path?: string; content?: string; open?: boolean }) => Document;
  importFiles: (files: { path: string; content: string }[]) => number;
  renameDoc: (id: string, newPath: string) => void;
  deleteDoc: (id: string) => void;
  toggleStar: (id: string) => void;
  setDocTags: (id: string, tags: string[]) => void;
  resetSeed: () => void;
  storageBytes: () => number;
};

function ensureUniquePath(path: string, docs: Document[], exceptId?: string): string {
  const set = new Set(docs.filter((d) => d.id !== exceptId).map((d) => d.path));
  return uniquePath(path, set);
}

export const useStore = create<LanghuanState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      documents: createSeedDocuments(),
      drafts: {},
      activeId: null,
      viewMode: "preview",
      theme: "paper",
      tagFilter: null,
      sidebarOpen: false,
      commandOpen: false,
      status: null,
      pendingReveal: null,
      pendingPreviewLocate: null,
      splitRatio: 0.5,
      splitSourceFirst: true,
      sidebarWidth: 280,
      outlineWidth: 240,
      outlineRailOpen: true,
      sidebarPanel: "docs",

      setHydrated: (v) => set({ hydrated: v }),
      setTheme: (t) => {
        set({ theme: t });
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", t === "ink");
        }
      },
      toggleTheme: () => {
        const next = get().theme === "paper" ? "ink" : "paper";
        get().setTheme(next);
        get().setStatus(next === "ink" ? "已切换到墨色主题" : "已切换到纸色主题");
      },
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setCommandOpen: (v) => set({ commandOpen: v }),
      setTagFilter: (t) => set({ tagFilter: t }),
      setViewMode: (m) => set({ viewMode: m }),
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
      setStatus: (message) => set({ status: { message, at: Date.now() } }),

      applyLocateResult: (result) => {
        if (result.precision === "none") {
          get().setStatus(result.message);
          return;
        }
        const viewMode = get().viewMode;
        if (viewMode === "preview") {
          set({ viewMode: "split" });
        }
        set({
          pendingReveal: {
            start: result.start,
            end: result.end,
            nonce: Date.now(),
          },
          status: { message: result.message, at: Date.now() },
        });
      },

      clearPendingReveal: () => set({ pendingReveal: null }),

      requestPreviewLocate: (offset) => {
        set({
          pendingPreviewLocate: { offset, nonce: Date.now() },
        });
      },

      clearPendingPreviewLocate: () => set({ pendingPreviewLocate: null }),

      openHome: () => set({ activeId: null }),
      openDoc: (id) => set({ activeId: id, sidebarOpen: false }),

      getActive: () => {
        const { activeId, documents } = get();
        return documents.find((d) => d.id === activeId) || null;
      },

      getContent: (id) => {
        const { drafts, documents } = get();
        if (id in drafts) return drafts[id];
        return documents.find((d) => d.id === id)?.content ?? "";
      },

      isDirty: (id) => {
        const { drafts, documents } = get();
        if (!(id in drafts)) return false;
        const doc = documents.find((d) => d.id === id);
        return !!doc && drafts[id] !== doc.content;
      },

      setDraft: (id, content) =>
        set((s) => ({ drafts: { ...s.drafts, [id]: content } })),

      saveDoc: (id) => {
        const target = id || get().activeId;
        if (!target) return;
        const content = get().getContent(target);
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === target ? { ...d, content, updatedAt: Date.now() } : d
          ),
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== target)),
        }));
        const doc = get().documents.find((d) => d.id === target);
        get().setStatus(`已保存 ${doc ? basename(doc.path) : ""}`);
      },

      discardDraft: (id) => {
        const target = id || get().activeId;
        if (!target) return;
        set((s) => ({
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== target)),
        }));
        get().setStatus("已放弃未保存修改");
      },

      createDoc: ({ type, path, content, open = true }) => {
        const ext = type === "md" ? ".md" : ".html";
        const defaultPath = type === "md" ? `未命名笔记${ext}` : `未命名页面${ext}`;
        const p = ensureUniquePath(path || defaultPath, get().documents);
        const defaultContent =
          content ??
          (type === "md"
            ? `---\ntitle: ${basename(p).replace(/\.md$/i, "")}\ntags: []\n---\n\n# ${basename(p).replace(/\.md$/i, "")}\n\n`
            : `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="keywords" content="" />\n  <title>${basename(p).replace(/\.html$/i, "")}</title>\n</head>\n<body>\n  <h1>${basename(p).replace(/\.html$/i, "")}</h1>\n</body>\n</html>\n`);
        const doc: Document = {
          id: uid(),
          path: p,
          type,
          content: defaultContent,
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          documents: [...s.documents, doc],
          activeId: open ? doc.id : s.activeId,
          viewMode: open ? "source" : s.viewMode,
        }));
        get().setStatus(`已新建 ${basename(doc.path)}`);
        return doc;
      },

      importFiles: (files) => {
        let n = 0;
        const docs = [...get().documents];
        for (const f of files) {
          if (!isImportableLibraryPath(f.path)) continue;
          const type = libraryDocTypeFromPath(f.path);
          let path = normalizeImportedPath(f.path);
          path = ensureUniquePath(path, docs);
          const doc: Document = {
            id: uid(),
            path,
            type,
            content: f.content,
            starred: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          docs.push(doc);
          n += 1;
        }
        set({ documents: docs });
        if (n) get().setStatus(`已导入 ${n} 个文件`);
        return n;
      },

      renameDoc: (id, newPath) => {
        const path = ensureUniquePath(newPath.replace(/\\/g, "/"), get().documents, id);
        const ext = path.toLowerCase().endsWith(".html")
          ? "html"
          : path.toLowerCase().endsWith(".md")
            ? "md"
            : null;
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  path,
                  type: (ext as Document["type"]) || d.type,
                  updatedAt: Date.now(),
                }
              : d
          ),
        }));
        get().setStatus(`已重命名为 ${basename(path)}`);
      },

      deleteDoc: (id) => {
        const doc = get().documents.find((d) => d.id === id);
        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id),
          drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
          activeId: s.activeId === id ? null : s.activeId,
        }));
        get().setStatus(doc ? `已删除 ${basename(doc.path)}` : "已删除");
      },

      toggleStar: (id) => {
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, starred: !d.starred } : d)),
        }));
      },

      setDocTags: (id, tags) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const cur = get().getContent(id);
        const next = doc.type === "md" ? setMdTags(cur, tags) : setHtmlTags(cur, tags);
        const dirty = get().isDirty(id) || id in get().drafts;
        if (dirty) {
          set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
        } else {
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, content: next, updatedAt: Date.now() } : d
            ),
          }));
        }
      },

      resetSeed: () => {
        set({
          documents: createSeedDocuments(),
          drafts: {},
          activeId: null,
        });
        get().setStatus("已恢复示例文档");
      },

      storageBytes: () => {
        if (typeof localStorage === "undefined") return 0;
        try {
          return new Blob([localStorage.getItem("langhuan-store") || ""]).size;
        } catch {
          return 0;
        }
      },
    }),
    {
      name: "langhuan-store",
      partialize: (s) => ({
        documents: s.documents,
        drafts: s.drafts,
        theme: s.theme,
        viewMode: s.viewMode,
        activeId: s.activeId,
        splitRatio: s.splitRatio,
        splitSourceFirst: s.splitSourceFirst,
        sidebarWidth: s.sidebarWidth,
        outlineWidth: s.outlineWidth,
        outlineRailOpen: s.outlineRailOpen,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state?.theme === "ink" && typeof document !== "undefined") {
          document.documentElement.classList.add("dark");
        }
        // Clamp legacy widths into the new layout ranges.
        if (state) {
          if (typeof state.sidebarWidth === "number") {
            state.setSidebarWidth(state.sidebarWidth);
          }
          if (typeof state.outlineRailOpen !== "boolean") {
            state.setOutlineRailOpen(true);
          }
        }
      },
    }
  )
);

export function filteredDocuments(
  docs: Document[],
  tagFilter: string | null
): Document[] {
  if (!tagFilter) return docs;
  return docs.filter((d) => getTags(d).includes(tagFilter));
}
