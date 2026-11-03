"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idbJSONStorage } from "@/lib/storage/idbPersist";
import {
  clearIdeHandle,
  getIdeFsCapability,
  isLikelyTextPath,
  listIdeDir,
  pickIdeFolder,
  readIdeFile,
  reopenIdeFolder,
  writeIdeFile,
  type IdeFolderSession,
  type IdeFsEntry,
} from "./ideFs";
import {
  IDE_RECENT_MAX,
  pushRecentProject,
  removeRecentProject,
  type IdeRecentProjectMeta,
} from "./recentProjects";
import {
  resolveDirtyClose,
  shouldBlockDirtyClose,
  type DirtyCloseChoice,
} from "./dirtyClose";
import { languageIdFromPath } from "./language";
import {
  buildIdePendingReveal,
  ideAncestorDirs,
  normalizeIdeRelPath,
  type IdePendingReveal,
} from "./citations";
import {
  appendExplainMessage,
  citationsFromMarkdown,
  IDE_EXPLAIN_HISTORY_MAX,
  planExplainSelectionRequest,
  type IdeExplainMessage,
  type IdeExplainSelection,
} from "./explain";
import {
  IDE_STORE_PERSIST_VERSION,
  migrateIdePersistedState,
} from "./idePersist";

export type IdeTab = {
  path: string;
  /** Last loaded / saved content. */
  savedContent: string;
  /** Working buffer. */
  draft: string;
};

export type IdePendingClose = {
  path: string;
  /** After resolve, optionally switch mode / close project. */
  after?: "none" | "closeProject" | "switchNotes";
};

export type IdeExplainSettings = {
  /** Optional OpenAI-compatible key; stays in IDE IDB only. */
  apiKey: string;
  baseUrl: string;
  model: string;
};

type IdeState = {
  recent: IdeRecentProjectMeta[];
  session: IdeFolderSession | null;
  /** Expanded folder paths in the explorer. */
  expanded: Record<string, boolean>;
  /** Cached children for listed dirs. */
  children: Record<string, IdeFsEntry[]>;
  tabs: IdeTab[];
  activePath: string | null;
  status: string | null;
  pendingClose: IdePendingClose | null;
  explorerOpen: boolean;
  loadingTree: boolean;

  /** After openFile: IdeEditor scrolls+highlights then clears. */
  pendingReveal: IdePendingReveal | null;
  /** After open/jump: explorer scrolls row into view then clears. */
  pendingExplorerReveal: { path: string; nonce: number } | null;
  /** Current editor selection for explain context. */
  selection: (IdeExplainSelection & { path: string }) | null;
  explainOpen: boolean;
  /** Explain chat keyed by project session.id */
  explainBySession: Record<string, IdeExplainMessage[]>;
  explainSettings: IdeExplainSettings;
  /** One-shot: open panel + auto-send (e.g. right-click 讲解选区). */
  pendingExplainRequest: {
    nonce: number;
    question: string;
    includeSelection: boolean;
    includeFile: boolean;
  } | null;

  setExplorerOpen: (v: boolean) => void;
  setStatus: (msg: string | null) => void;
  openFolder: () => Promise<boolean>;
  openRecent: (id: string) => Promise<boolean>;
  closeProject: (opts?: { force?: boolean }) => boolean;
  removeRecent: (id: string) => Promise<void>;
  ensureDirListed: (relDir: string) => Promise<void>;
  toggleExpanded: (relDir: string) => void;
  openFile: (
    path: string,
    opts?: { line?: number; endLine?: number; softFail?: boolean }
  ) => Promise<boolean>;
  clearPendingReveal: () => void;
  clearPendingExplorerReveal: () => void;
  setDraft: (path: string, draft: string) => void;
  setSelection: (sel: (IdeExplainSelection & { path: string }) | null) => void;
  saveFile: (path?: string | null) => Promise<boolean>;
  requestCloseTab: (path: string, after?: IdePendingClose["after"]) => void;
  resolvePendingClose: (choice: DirtyCloseChoice) => Promise<void>;
  isDirty: (path: string) => boolean;
  anyDirty: () => boolean;
  requestSwitchToNotes: () => boolean;

  setExplainOpen: (v: boolean) => void;
  toggleExplainOpen: () => void;
  clearExplainHistory: () => void;
  pushExplainMessage: (msg: IdeExplainMessage) => void;
  updateLastAssistant: (content: string, extra?: { mock?: boolean }) => void;
  setExplainSettings: (patch: Partial<IdeExplainSettings>) => void;
  requestExplainSelection: () => boolean;
  clearPendingExplainRequest: () => void;
};

const IDE_STORE_KEY = "langhuan-ide-store";

function tabBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function rememberSession(
  set: (p: Partial<IdeState> | ((s: IdeState) => Partial<IdeState>)) => void,
  get: () => IdeState,
  session: IdeFolderSession
) {
  const meta: IdeRecentProjectMeta = {
    id: session.id,
    name: session.name,
    pathLabel: session.pathLabel,
    lastOpenedAt: Date.now(),
  };
  set({
    session,
    recent: pushRecentProject(get().recent, meta, IDE_RECENT_MAX),
    tabs: [],
    activePath: null,
    children: {},
    expanded: { "": true },
    pendingReveal: null,
    pendingExplorerReveal: null,
    selection: null,
    pendingExplainRequest: null,
    status: `已打开工程「${session.name}」`,
  });
}

export const useIdeStore = create<IdeState>()(
  persist(
    (set, get) => ({
      recent: [],
      session: null,
      expanded: { "": true },
      children: {},
      tabs: [],
      activePath: null,
      status: null,
      pendingClose: null,
      explorerOpen: true,
      loadingTree: false,
      pendingReveal: null,
      pendingExplorerReveal: null,
      selection: null,
      explainOpen: false,
      explainBySession: {},
      explainSettings: {
        apiKey: "",
        baseUrl: "",
        model: "",
      },
      pendingExplainRequest: null,

      setExplorerOpen: (v) => set({ explorerOpen: v }),
      setStatus: (msg) => set({ status: msg }),
      clearPendingReveal: () => set({ pendingReveal: null }),
      clearPendingExplorerReveal: () => set({ pendingExplorerReveal: null }),
      setSelection: (sel) => set({ selection: sel }),
      setExplainOpen: (v) => set({ explainOpen: v }),
      toggleExplainOpen: () => set((s) => ({ explainOpen: !s.explainOpen })),
      setExplainSettings: (patch) =>
        set((s) => ({
          explainSettings: { ...s.explainSettings, ...patch },
        })),
      clearPendingExplainRequest: () => set({ pendingExplainRequest: null }),
      requestExplainSelection: () => {
        const planned = planExplainSelectionRequest(get().selection);
        if (!planned) return false;
        set({
          explainOpen: true,
          pendingExplainRequest: {
            nonce: Date.now(),
            question: planned.question,
            includeSelection: true,
            includeFile: planned.includeFile,
          },
        });
        return true;
      },

      clearExplainHistory: () => {
        const id = get().session?.id;
        if (!id) return;
        set((s) => {
          const next = { ...s.explainBySession };
          delete next[id];
          return { explainBySession: next };
        });
      },

      pushExplainMessage: (msg) => {
        const id = get().session?.id;
        if (!id) return;
        set((s) => {
          const prev = s.explainBySession[id] || [];
          return {
            explainBySession: {
              ...s.explainBySession,
              [id]: appendExplainMessage(prev, msg, IDE_EXPLAIN_HISTORY_MAX),
            },
          };
        });
      },

      updateLastAssistant: (content, extra) => {
        const id = get().session?.id;
        if (!id) return;
        set((s) => {
          const prev = [...(s.explainBySession[id] || [])];
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i]!.role === "assistant") {
              prev[i] = {
                ...prev[i]!,
                content,
                citations: citationsFromMarkdown(content),
                mock: extra?.mock ?? prev[i]!.mock,
              };
              break;
            }
          }
          return {
            explainBySession: { ...s.explainBySession, [id]: prev },
          };
        });
      },

      openFolder: async () => {
        const cap = getIdeFsCapability();
        if (!cap.canPickFolder) {
          set({ status: cap.unsupportedHint });
          return false;
        }
        if (get().anyDirty()) {
          const dirty = get().tabs.find((t) => get().isDirty(t.path));
          if (dirty) {
            set({
              pendingClose: { path: dirty.path, after: "none" },
              status: "请先处理未保存的文件，再打开新工程",
            });
            return false;
          }
        }
        const session = await pickIdeFolder();
        if (!session) return false;
        rememberSession(set, get, session);
        await get().ensureDirListed("");
        return true;
      },

      openRecent: async (id) => {
        const meta = get().recent.find((r) => r.id === id);
        if (!meta) {
          set({ status: "找不到该最近工程" });
          return false;
        }
        const session = await reopenIdeFolder(id, meta);
        if (!session) {
          set({
            status: "无法恢复目录授权，请重新「打开文件夹」",
            recent: removeRecentProject(get().recent, id),
          });
          await clearIdeHandle(id);
          return false;
        }
        rememberSession(set, get, session);
        await get().ensureDirListed("");
        return true;
      },

      closeProject: (opts) => {
        const force = opts?.force === true;
        if (!force && get().anyDirty()) {
          const dirty = get().tabs.find((t) => get().isDirty(t.path));
          if (dirty) {
            set({ pendingClose: { path: dirty.path, after: "closeProject" } });
            return false;
          }
        }
        set({
          session: null,
          tabs: [],
          activePath: null,
          children: {},
          expanded: { "": true },
          pendingClose: null,
          pendingReveal: null,
          selection: null,
          pendingExplainRequest: null,
          status: "已关闭工程",
        });
        return true;
      },

      removeRecent: async (id) => {
        set({ recent: removeRecentProject(get().recent, id) });
        await clearIdeHandle(id);
      },

      ensureDirListed: async (relDir) => {
        const session = get().session;
        if (!session) return;
        const key = relDir;
        if (get().children[key]) return;
        set({ loadingTree: true });
        try {
          const entries = await listIdeDir(session, relDir);
          set((s) => ({
            children: { ...s.children, [key]: entries },
            loadingTree: false,
          }));
        } catch (e) {
          set({
            loadingTree: false,
            status: `读取目录失败：${e instanceof Error ? e.message : String(e)}`,
          });
        }
      },

      toggleExpanded: (relDir) => {
        const next = !get().expanded[relDir];
        set((s) => ({ expanded: { ...s.expanded, [relDir]: next } }));
        if (next) void get().ensureDirListed(relDir);
      },

      openFile: async (path, opts) => {
        const session = get().session;
        if (!session) return false;
        const norm = normalizeIdeRelPath(path);
        if (!isLikelyTextPath(norm)) {
          if (!opts?.softFail) {
            set({ status: `暂不支持打开二进制或未知类型：${tabBasename(norm)}` });
          }
          return false;
        }

        const revealInExplorer = (filePath: string) => {
          const ancestors = ideAncestorDirs(filePath);
          set((s) => {
            const expanded: Record<string, boolean> = { ...s.expanded, "": true };
            for (const d of ancestors) expanded[d] = true;
            return {
              expanded,
              explorerOpen: true,
              pendingExplorerReveal: {
                path: filePath,
                nonce: (s.pendingExplorerReveal?.nonce ?? 0) + 1,
              },
            };
          });
          void (async () => {
            await get().ensureDirListed("");
            for (const d of ancestors) {
              await get().ensureDirListed(d);
            }
          })();
        };

        const lineCountHint = (() => {
          const tab = get().tabs.find((t) => t.path === norm);
          if (!tab) return undefined;
          return Math.max(1, tab.draft.split("\n").length);
        })();

        const reveal =
          opts?.line != null
            ? buildIdePendingReveal(norm, opts.line, opts.endLine, lineCountHint)
            : null;

        const existing = get().tabs.find((t) => t.path === norm);
        if (existing) {
          set({
            activePath: norm,
            pendingReveal: reveal,
            status:
              reveal != null
                ? `${tabBasename(norm)} · L${reveal.line}`
                : `${tabBasename(norm)} · ${languageIdFromPath(norm)}`,
          });
          revealInExplorer(norm);
          return true;
        }
        try {
          const content = await readIdeFile(session, norm);
          const tab: IdeTab = {
            path: norm,
            savedContent: content,
            draft: content,
          };
          const docLines = Math.max(1, content.split("\n").length);
          const reveal2 =
            opts?.line != null
              ? buildIdePendingReveal(norm, opts.line, opts.endLine, docLines)
              : null;
          set((s) => ({
            tabs: [...s.tabs, tab],
            activePath: norm,
            pendingReveal: reveal2,
            status:
              reveal2 != null
                ? `${tabBasename(norm)} · L${reveal2.line}`
                : `${tabBasename(norm)} · ${languageIdFromPath(norm)}`,
          }));
          revealInExplorer(norm);
          return true;
        } catch (e) {
          if (!opts?.softFail) {
            set({
              status: `打开失败：${e instanceof Error ? e.message : String(e)}`,
            });
          }
          return false;
        }
      },

      setDraft: (path, draft) => {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, draft } : t)),
        }));
      },

      saveFile: async (path) => {
        const session = get().session;
        const target = path ?? get().activePath;
        if (!session || !target) return false;
        const tab = get().tabs.find((t) => t.path === target);
        if (!tab) return false;
        try {
          await writeIdeFile(session, target, tab.draft);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.path === target ? { ...t, savedContent: t.draft } : t
            ),
            status: `已保存 ${tabBasename(target)}`,
          }));
          return true;
        } catch (e) {
          set({
            status: `保存失败：${e instanceof Error ? e.message : String(e)}`,
          });
          return false;
        }
      },

      requestCloseTab: (path, after = "none") => {
        if (shouldBlockDirtyClose(get().isDirty(path))) {
          set({ pendingClose: { path, after } });
          return;
        }
        set((s) => {
          const tabs = s.tabs.filter((t) => t.path !== path);
          let activePath = s.activePath;
          if (activePath === path) {
            const idx = s.tabs.findIndex((t) => t.path === path);
            activePath =
              tabs[Math.min(idx, tabs.length - 1)]?.path ??
              tabs[0]?.path ??
              null;
          }
          return {
            tabs,
            activePath,
            pendingClose: null,
            pendingReveal:
              s.pendingReveal?.path === path ? null : s.pendingReveal,
          };
        });
        if (after === "closeProject") get().closeProject({ force: true });
        if (after === "switchNotes") {
          /* caller watches via a callback — handled in resolve / shell */
        }
      },

      resolvePendingClose: async (choice) => {
        const pending = get().pendingClose;
        if (!pending) return;
        const resolved = resolveDirtyClose(choice);
        if (!resolved.proceed) {
          set({ pendingClose: null });
          return;
        }
        if (resolved.saveFirst) {
          const ok = await get().saveFile(pending.path);
          if (!ok) return;
        }
        // discard or saved — close tab
        set((s) => {
          const tabs = s.tabs.filter((t) => t.path !== pending.path);
          let activePath = s.activePath;
          if (activePath === pending.path) {
            const idx = s.tabs.findIndex((t) => t.path === pending.path);
            activePath =
              tabs[Math.min(idx, tabs.length - 1)]?.path ??
              tabs[0]?.path ??
              null;
          }
          return {
            tabs,
            activePath,
            pendingClose: null,
            pendingReveal:
              s.pendingReveal?.path === pending.path ? null : s.pendingReveal,
          };
        });

        if (pending.after === "closeProject") {
          // If more dirty tabs remain, prompt next
          if (get().anyDirty()) {
            const dirty = get().tabs.find((t) => get().isDirty(t.path));
            if (dirty) {
              set({ pendingClose: { path: dirty.path, after: "closeProject" } });
              return;
            }
          }
          get().closeProject({ force: true });
        }
      },

      isDirty: (path) => {
        const tab = get().tabs.find((t) => t.path === path);
        if (!tab) return false;
        return tab.draft !== tab.savedContent;
      },

      anyDirty: () => get().tabs.some((t) => get().isDirty(t.path)),

      requestSwitchToNotes: () => {
        if (!get().anyDirty()) return true;
        const dirty = get().tabs.find((t) => get().isDirty(t.path));
        if (dirty) {
          set({ pendingClose: { path: dirty.path, after: "switchNotes" } });
          return false;
        }
        return true;
      },
    }),
    {
      name: IDE_STORE_KEY,
      storage: idbJSONStorage,
      partialize: (s) => ({
        recent: s.recent.slice(0, IDE_RECENT_MAX),
        explorerOpen: s.explorerOpen,
        explainOpen: s.explainOpen,
        explainBySession: s.explainBySession,
        explainSettings: {
          // Persist key in IDE store only (local tool); never mirror into notes store.
          apiKey: s.explainSettings.apiKey,
          baseUrl: s.explainSettings.baseUrl,
          model: s.explainSettings.model,
        },
      }),
      version: IDE_STORE_PERSIST_VERSION,
      migrate: (persisted, fromVersion) =>
        migrateIdePersistedState(persisted, fromVersion),
    }
  )
);

export type { IdeRecentProjectMeta, IdePendingReveal, IdeExplainMessage };
export {
  IDE_STORE_PERSIST_VERSION,
  migrateIdePersistedState,
  type IdePersistedSlice,
} from "./idePersist";

