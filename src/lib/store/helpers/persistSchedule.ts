"use client";

import type { Document } from "../../types";
import { putLibraryDoc } from "../../storage/contentApi";
import { writeThroughDoc } from "../../storage/fsSync";
import { renameScrollMemoryMany } from "../../scrollMemory";
import type { LanghuanState } from "../types";

function scheduleWriteThrough(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, doc: Document | undefined) {
  if (!doc || !get().fsBoundName) return;
  void writeThroughDoc(doc)
    .then((ok) => {
      if (ok) set({ fsLastSyncAt: Date.now() });
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      get().setStatus(`主库已写、镜像失败：${msg}`);
    });
}

export type ContentPersistResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Per-path write chain.
 *
 * Two writes for the same note must land in call order: a create-triggered
 * persist that resolves late would otherwise overwrite a later append. Small,
 * local, and keyed by path so unrelated notes never wait on each other.
 */
const pathWriteChains = new Map<string, Promise<unknown>>();
// Only tracks unconfirmed operations, never a second copy of draft text.
const unconfirmedWrites = new Map<string, number>();
let writeSequence = 0;
export function isContentUnconfirmed(docId: string): boolean {
  return unconfirmedWrites.has(docId);
}

/** A failed bulk mutation may have partially landed: keep current text retryable. */
export function keepContentDrafts(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, ids: string[]) {
  const wanted = new Set(ids);
  const drafts = { ...get().drafts };
  for (const doc of get().documents) {
    if (!wanted.has(doc.id)) continue;
    unconfirmedWrites.set(doc.id, ++writeSequence);
    drafts[doc.id] = drafts[doc.id] ?? doc.content;
  }
  set({ drafts });
}

function enqueuePathWrite<T>(keys: string[], task: () => Promise<T>): Promise<T> {
  const unique = [...new Set(keys)];
  const run = Promise.all(unique.map((key) => pathWriteChains.get(key))).then(task);
  const tail = run.catch(() => undefined);
  for (const key of unique) pathWriteChains.set(key, tail);
  void tail.then(() => {
    for (const key of unique) {
      if (pathWriteChains.get(key) === tail) pathWriteChains.delete(key);
    }
  });
  return run;
}

async function writePrimary(
  get: () => LanghuanState,
  set: (p: Partial<LanghuanState>) => void,
  doc: Document,
  previousPath?: string
): Promise<ContentPersistResult> {
  try {
    await putLibraryDoc(doc, previousPath);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  /* content/ is source of truth — mirror only after primary write succeeds */
  scheduleWriteThrough(get, set, doc);
  return { ok: true };
}

/**
 * Primary persist, awaitable: write the doc into repo content/ and only then
 * mirror to the bound FS folder. Callers that must not claim success before
 * the write lands (e.g. 收入速记) await this instead of `scheduleContentPersist`.
 */
export function persistContent(
  get: () => LanghuanState,
  set: (p: Partial<LanghuanState>) => void,
  doc: Document | undefined,
  previousPath?: string
): Promise<ContentPersistResult> {
  if (!doc) return Promise.resolve({ ok: false, message: "没有可写入的文档" });
  const sequence = ++writeSequence;
  unconfirmedWrites.set(doc.id, sequence);
  // Keep per-path ordering, and also order the same note across a rename.
  const keys = [`path:${doc.path}`, `doc:${doc.id}`, ...(previousPath ? [`path:${previousPath}`] : [])];
  return enqueuePathWrite(keys, () => writePrimary(get, set, doc, previousPath)).then((result) => {
    if (result.ok && unconfirmedWrites.get(doc.id) === sequence) unconfirmedWrites.delete(doc.id);
    return result;
  });
}

/** Scheduled primary persist: reports failures; callers may await confirmation. */
export function scheduleContentPersist(
  get: () => LanghuanState,
  set: (p: Partial<LanghuanState>) => void,
  doc: Document | undefined,
  previousPath?: string
) {
  if (!doc) return Promise.resolve<ContentPersistResult>({ ok: false, message: "没有可写入的文档" });
  return persistContent(get, set, doc, previousPath).then((r) => {
    if (!r.ok) {
      const current = get().documents.find((d) => d.id === doc.id);
      if (current) {
        if (previousPath && current.path === doc.path) {
          renameScrollMemoryMany([[doc.path, previousPath]]);
        }
        // Retain the latest text in the existing persisted draft map. A failed
        // move rolls back its path, so repeating rename retries the same move.
        set({
          documents: get().documents.map((d) => d.id === doc.id && d.path === doc.path && previousPath ? { ...d, path: previousPath } : d),
          drafts: { ...get().drafts, [doc.id]: get().drafts[doc.id] ?? current.content },
        });
      }
      get().setStatus(`写入 content/ 失败（草稿已保留，可重新保存/移动）：${r.message}`);
    }
    return r;
  });
}
