/**
 * 讲解输入框未发送草稿。关面板 / 切对话 / 刷新后还在。
 *
 * 单独放 localStorage，不进 ide persist：不必为此升 store 版本，也不把草稿
 * 和 apiKey 写在同一份 blob 里。按「工程 + 对话」记；空对话的草稿在首条
 * thread id 出现时迁过去，避免空工程先打字再开对话把字弄丢。
 */

export const EXPLAIN_DRAFT_STORAGE_KEY = "lh.explainDraft";
export const EXPLAIN_DRAFT_MAX_CHARS = 8000;
export const EXPLAIN_DRAFT_MAX_ENTRIES = 40;

export type ExplainDraftEntry = {
  text: string;
  savedAt: number;
};

type ExplainDraftMap = Record<string, ExplainDraftEntry>;

const listeners = new Set<() => void>();

function emitExplainDrafts(): void {
  listeners.forEach((fn) => fn());
}

/** 供输入框用 useSyncExternalStore 订阅；同页 write 会通知，跨标签走 storage。 */
export function subscribeExplainDrafts(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStoreChange);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStoreChange);
    }
  };
}

export function snapshotExplainDraft(sessionId: string, threadId: string): string {
  if (!sessionId) return "";
  const direct = readExplainDraft(sessionId, threadId);
  if (direct) return direct;
  return threadId ? readExplainDraft(sessionId, "") : "";
}

export function explainDraftStorageKey(sessionId: string, threadId: string): string {
  return `${sessionId}::${threadId}`;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isEntry(v: unknown): v is ExplainDraftEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.text === "string" && typeof e.savedAt === "number" && Number.isFinite(e.savedAt);
}

function clip(text: string): string {
  return text.length > EXPLAIN_DRAFT_MAX_CHARS
    ? text.slice(0, EXPLAIN_DRAFT_MAX_CHARS)
    : text;
}

function readMap(): ExplainDraftMap {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(EXPLAIN_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ExplainDraftMap = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || !isEntry(entry) || !entry.text) continue;
      out[key] = { text: clip(entry.text), savedAt: entry.savedAt };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: ExplainDraftMap): void {
  const s = storage();
  if (!s) return;
  try {
    const keys = Object.keys(map);
    if (keys.length > EXPLAIN_DRAFT_MAX_ENTRIES) {
      keys
        .sort((a, b) => (map[a]!.savedAt ?? 0) - (map[b]!.savedAt ?? 0))
        .slice(0, keys.length - EXPLAIN_DRAFT_MAX_ENTRIES)
        .forEach((k) => delete map[k]);
    }
    if (Object.keys(map).length === 0) {
      s.removeItem(EXPLAIN_DRAFT_STORAGE_KEY);
    } else {
      s.setItem(EXPLAIN_DRAFT_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // 配额满 / 隐私模式：丢掉草稿不影响发送，静默放弃。
  }
  emitExplainDrafts();
}

/** 读某工程某对话的未发送草稿；没有或数据坏了返回空串。 */
export function readExplainDraft(sessionId: string, threadId: string): string {
  if (!sessionId) return "";
  const entry = readMap()[explainDraftStorageKey(sessionId, threadId)];
  return entry?.text ?? "";
}

/**
 * 记下或清掉草稿。空串删除该条，避免用空白占名额。
 */
export function writeExplainDraft(
  sessionId: string,
  threadId: string,
  text: string
): void {
  if (!sessionId) return;
  const key = explainDraftStorageKey(sessionId, threadId);
  const map = readMap();
  const trimmedKeep = typeof text === "string" ? text : "";
  if (!trimmedKeep) {
    if (!(key in map)) return;
    delete map[key];
    writeMap(map);
    return;
  }
  map[key] = { text: clip(trimmedKeep), savedAt: Date.now() };
  writeMap(map);
}

/** 空 thread id 上的草稿迁到真正的对话 id，目的地已有内容则不覆盖。 */
export function adoptExplainDraft(
  sessionId: string,
  fromThreadId: string,
  toThreadId: string
): string {
  if (!sessionId || fromThreadId === toThreadId) {
    return readExplainDraft(sessionId, toThreadId);
  }
  const map = readMap();
  const fromKey = explainDraftStorageKey(sessionId, fromThreadId);
  const toKey = explainDraftStorageKey(sessionId, toThreadId);
  const from = map[fromKey];
  if (!from?.text) return map[toKey]?.text ?? "";
  delete map[fromKey];
  if (!map[toKey]?.text) {
    map[toKey] = from;
  }
  writeMap(map);
  return map[toKey]?.text ?? "";
}
