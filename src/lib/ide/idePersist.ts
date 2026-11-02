/**
 * Persist migrate for langhuan-ide-store (pure; safe for vitest).
 * v1: recent + explorerOpen. v2: + explain panel fields.
 */

import { IDE_RECENT_MAX, type IdeRecentProjectMeta } from "./recentProjects";
import {
  IDE_EXPLAIN_HISTORY_MAX,
  type IdeExplainMessage,
} from "./explain";

export const IDE_STORE_PERSIST_VERSION = 2;

export type IdeExplainSettingsPersisted = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Shape written by partialize — migrate fills missing fields from older blobs. */
export type IdePersistedSlice = {
  recent: IdeRecentProjectMeta[];
  explorerOpen: boolean;
  explainOpen: boolean;
  explainBySession: Record<string, IdeExplainMessage[]>;
  explainSettings: IdeExplainSettingsPersisted;
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
    out[key] = val.slice(-IDE_EXPLAIN_HISTORY_MAX) as IdeExplainMessage[];
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
 * fromVersion 0/1 only had recent + explorerOpen; v2 adds explain fields.
 * Ephemeral runtime fields (pendingReveal, tabs, session) are never restored.
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
    explorerOpen: typeof p.explorerOpen === "boolean" ? p.explorerOpen : true,
    explainOpen: typeof p.explainOpen === "boolean" ? p.explainOpen : false,
    explainBySession: normalizeExplainBySession(p.explainBySession),
    explainSettings: normalizeExplainSettings(p.explainSettings),
  };
  void fromVersion;
  return slice;
}
