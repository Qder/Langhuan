import {
  appendExplainMessage,
  citationsFromMarkdown,
  IDE_EXPLAIN_HISTORY_MAX,
  type IdeExplainMessage,
} from "./explain";

/** Per-project conversation threads kept in langhuan-ide-store. */
export const IDE_EXPLAIN_THREADS_MAX = 12;
export const IDE_EXPLAIN_THREAD_TITLE_MAX = 28;

export type IdeExplainThread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: IdeExplainMessage[];
};

export function newExplainThreadId(now = Date.now()): string {
  return `t_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function clipExplainThreadTitle(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "新对话";
  if (one.length <= IDE_EXPLAIN_THREAD_TITLE_MAX) return one;
  return `${one.slice(0, IDE_EXPLAIN_THREAD_TITLE_MAX - 1)}…`;
}

export function titleFromExplainMessages(
  messages: IdeExplainMessage[]
): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  return clipExplainThreadTitle(firstUser?.content ?? "");
}

export function emptyExplainThread(now = Date.now()): IdeExplainThread {
  return {
    id: newExplainThreadId(now),
    title: "新对话",
    updatedAt: now,
    messages: [],
  };
}

export function messagesOfActiveExplainThread(
  threads: IdeExplainThread[],
  activeId: string | undefined
): IdeExplainMessage[] {
  const t =
    threads.find((x) => x.id === activeId) ??
    threads[0] ??
    null;
  return t?.messages ?? [];
}

export function capExplainThreads(
  threads: IdeExplainThread[],
  activeId: string
): IdeExplainThread[] {
  if (threads.length <= IDE_EXPLAIN_THREADS_MAX) return threads;
  const active = threads.find((t) => t.id === activeId);
  const rest = threads
    .filter((t) => t.id !== activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = rest.slice(0, IDE_EXPLAIN_THREADS_MAX - (active ? 1 : 0));
  const out = active ? [active, ...kept] : kept;
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Keep at most one empty thread, and always the kept one.
 *
 * 清空当前对话 leaves an empty thread behind, and 新对话 adds another one.
 * Without this, the history drawer fills with identical 「新对话 · 空对话」
 * rows that carry nothing. The active thread is never dropped, even if empty.
 */
export function pruneEmptyExplainThreads(
  threads: IdeExplainThread[],
  keepId: string | undefined
): IdeExplainThread[] {
  const empties = threads.filter((t) => t.messages.length === 0);
  if (empties.length <= 1) return threads;
  const keep =
    empties.find((t) => t.id === keepId) ??
    [...empties].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
  return threads.filter((t) => t.messages.length > 0 || t.id === keep.id);
}

/**
 * v5 blob (or an in-memory HMR state) may still hold a message list without
 * threads. Seed one thread instead of dropping the history.
 */
export function seedExplainThreads(
  threads: IdeExplainThread[],
  messages: IdeExplainMessage[],
  now = Date.now()
): IdeExplainThread[] {
  if (threads.length > 0 || messages.length === 0) return threads;
  const t = emptyExplainThread(now);
  return [
    {
      ...t,
      title: titleFromExplainMessages(messages),
      messages,
      updatedAt: messages[messages.length - 1]?.createdAt || now,
    },
  ];
}

export function ensureActiveExplainThread(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  if (threads.length === 0) {
    const t = emptyExplainThread(now);
    return { threads: [t], activeId: t.id };
  }
  if (activeId && threads.some((t) => t.id === activeId)) {
    return { threads, activeId };
  }
  const newest = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
  return { threads, activeId: newest.id };
}

export function applyStartExplainThread(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  const ensured = ensureActiveExplainThread(threads, activeId, now);
  const current = ensured.threads.find((t) => t.id === ensured.activeId);
  if (current && current.messages.length === 0) {
    return ensured;
  }
  const next = emptyExplainThread(now);
  return {
    threads: pruneEmptyExplainThreads(
      capExplainThreads([next, ...ensured.threads], next.id),
      next.id
    ),
    activeId: next.id,
  };
}

export function applySwitchExplainThread(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  wantId: string,
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  const ensured = ensureActiveExplainThread(threads, activeId, now);
  if (!ensured.threads.some((t) => t.id === wantId)) return ensured;
  return { threads: ensured.threads, activeId: wantId };
}

export function applyClearActiveExplainThread(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  const ensured = ensureActiveExplainThread(threads, activeId, now);
  const cleared = ensured.threads.map((t) =>
    t.id === ensured.activeId
      ? { ...t, title: "新对话", messages: [], updatedAt: now }
      : t
  );
  return {
    activeId: ensured.activeId,
    threads: pruneEmptyExplainThreads(cleared, ensured.activeId),
  };
}

export function applyPushExplainMessage(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  msg: IdeExplainMessage,
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  const ensured = ensureActiveExplainThread(threads, activeId, now);
  const threadsNext = ensured.threads.map((t) => {
    if (t.id !== ensured.activeId) return t;
    const messages = appendExplainMessage(
      t.messages,
      msg,
      IDE_EXPLAIN_HISTORY_MAX
    );
    return {
      ...t,
      messages,
      updatedAt: now,
      title: titleFromExplainMessages(messages),
    };
  });
  return {
    threads: pruneEmptyExplainThreads(threadsNext, ensured.activeId),
    activeId: ensured.activeId,
  };
}

export function applyUpdateLastAssistant(
  threads: IdeExplainThread[],
  activeId: string | undefined,
  content: string,
  extra?: { mock?: boolean },
  now = Date.now()
): { threads: IdeExplainThread[]; activeId: string } {
  const ensured = ensureActiveExplainThread(threads, activeId, now);
  const threadsNext = ensured.threads.map((t) => {
    if (t.id !== ensured.activeId) return t;
    const prev = [...t.messages];
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
    return { ...t, messages: prev, updatedAt: now };
  });
  return { threads: threadsNext, activeId: ensured.activeId };
}

export function listExplainThreadsNewestFirst(
  threads: IdeExplainThread[]
): IdeExplainThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * A blob may carry thread messages in the legacy `explainBySession` map (or a
 * v6 write that happened before threads existed). Lift those into a thread so a
 * reload never shows messages with an empty history drawer.
 */
export function threadsFromExplainBySession(
  bySession: Record<string, IdeExplainMessage[]>,
  threads: Record<string, IdeExplainThread[]>,
  now = Date.now()
): Record<string, IdeExplainThread[]> {
  let changed = false;
  const out: Record<string, IdeExplainThread[]> = { ...threads };
  for (const [sid, messages] of Object.entries(bySession)) {
    if (out[sid]?.length) continue;
    if (!messages.length) continue;
    const t = emptyExplainThread(now);
    out[sid] = [
      {
        ...t,
        title: titleFromExplainMessages(messages),
        messages,
        updatedAt: messages[messages.length - 1]?.createdAt || now,
      },
    ];
    changed = true;
  }
  return changed ? out : threads;
}

/** True when a rehydrated blob needs lifting (messages but no threads). */
export function needsExplainThreadBackfill(
  bySession: Record<string, IdeExplainMessage[]>,
  threads: Record<string, IdeExplainThread[]>
): boolean {
  return Object.entries(bySession).some(
    ([sid, messages]) => messages.length > 0 && !(threads[sid]?.length)
  );
}
