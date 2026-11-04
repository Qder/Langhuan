/**
 * Persist migrate for langhuan-ide-store (pure; safe for vitest).
 * v1: recent + explorerOpen. v2: + explain panel fields. v3: + recentFiles.
 * v4: + pendingIdeLink (a note link waiting for a project must survive reload).
 * v5: + outlineOpen (the reading rail the user left open).
 */

import { IDE_RECENT_MAX, type IdeRecentProjectMeta } from "./recentProjects";
import {
  IDE_RECENT_FILES_MAX,
  normalizeRecentFiles,
  type IdeRecentFile,
} from "./recentFiles";
import {
  IDE_EXPLAIN_HISTORY_MAX,
  normalizeExplainFilePayloads,
  type IdeExplainMessage,
} from "./explain";
import { normalizePendingIdeLink } from "./pendingLink";
import type { IdeLinkTarget } from "./ideLink";

export const IDE_STORE_PERSIST_VERSION = 5;

export type IdeExplainSettingsPersisted = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Shape written by partialize — migrate fills missing fields from older blobs. */
export type IdePersistedSlice = {
  recent: IdeRecentProjectMeta[];
  /** v3: recently opened files (cross-project). */
  recentFiles: IdeRecentFile[];
  explorerOpen: boolean;
  /** v5: 当前文件大纲 rail. */
  outlineOpen: boolean;
  explainOpen: boolean;
  explainBySession: Record<string, IdeExplainMessage[]>;
  explainSettings: IdeExplainSettingsPersisted;
  /** v4: a `[[ide:…]]` link waiting for its project. */
  pendingIdeLink: IdeLinkTarget | null;
};

const DEFAULT_EXPLAIN_SETTINGS: IdeExplainSettingsPersisted = {
  apiKey: "",
  baseUrl: "",
  model: "",
};

function normalizeRecentList(raw: unknown): IdeRecentProjectMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: IdeRecentProjectMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    out.push({
      id,
      name: typeof r.name === "string" && r.name ? r.name : id,
      pathLabel:
        typeof r.pathLabel === "string" && r.pathLabel
          ? r.pathLabel
          : typeof r.name === "string" && r.name
            ? r.name
            : id,
      lastOpenedAt: typeof r.lastOpenedAt === "number" ? r.lastOpenedAt : 0,
    });
  }
  return out.slice(0, IDE_RECENT_MAX);
}

function normalizeExplainBySession(
  raw: unknown
): Record<string, IdeExplainMessage[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, IdeExplainMessage[]> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !Array.isArray(val)) continue;
    const msgs: IdeExplainMessage[] = [];
    for (const item of val.slice(-IDE_EXPLAIN_HISTORY_MAX)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : "";
      const content = typeof rec.content === "string" ? rec.content : "";
      if (!id || !role) continue;
      const files = normalizeExplainFilePayloads(rec.files);
      const citations = Array.isArray(rec.citations)
        ? rec.citations.flatMap((c) => {
            if (!c || typeof c !== "object" || Array.isArray(c)) return [];
            const row = c as Record<string, unknown>;
            if (typeof row.path !== "string" || !row.path) return [];
            return [
              {
                path: row.path,
                line: typeof row.line === "number" ? row.line : undefined,
                endLine: typeof row.endLine === "number" ? row.endLine : undefined,
              },
            ];
          })
        : undefined;
      msgs.push({
        id,
        role,
        content,
        createdAt: typeof rec.createdAt === "number" ? rec.createdAt : 0,
        mock: rec.mock === true ? true : undefined,
        files,
        citations: citations?.length ? citations : undefined,
      });
    }
    if (msgs.length) out[key] = msgs;
  }
  return out;
}

function normalizeExplainSettings(raw: unknown): IdeExplainSettingsPersisted {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_EXPLAIN_SETTINGS };
  }
  const s = raw as Record<string, unknown>;
  return {
    apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
    baseUrl: typeof s.baseUrl === "string" ? s.baseUrl : "",
    model: typeof s.model === "string" ? s.model : "",
  };
}

/**
 * Upgrade IDB persist blobs for langhuan-ide-store.
 * fromVersion 0/1 only had recent + explorerOpen; v2 adds explain fields;
 * v3 adds recentFiles; v4 adds the pending note link. Ephemeral runtime fields
 * (pendingReveal, tabs, session) are never restored.
 */
export function migrateIdePersistedState(
  persisted: unknown,
  fromVersion: number
): IdePersistedSlice {
  const p =
    persisted && typeof persisted === "object" && !Array.isArray(persisted)
      ? (persisted as Record<string, unknown>)
      : {};

  const slice: IdePersistedSlice = {
    recent: normalizeRecentList(p.recent),
    recentFiles: normalizeRecentFiles(p.recentFiles, IDE_RECENT_FILES_MAX),
    explorerOpen: typeof p.explorerOpen === "boolean" ? p.explorerOpen : true,
    outlineOpen: typeof p.outlineOpen === "boolean" ? p.outlineOpen : false,
    explainOpen: typeof p.explainOpen === "boolean" ? p.explainOpen : false,
    explainBySession: normalizeExplainBySession(p.explainBySession),
    explainSettings: normalizeExplainSettings(p.explainSettings),
    pendingIdeLink: normalizePendingIdeLink(p.pendingIdeLink),
  };
  void fromVersion;
  return slice;
}
