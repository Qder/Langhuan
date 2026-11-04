"use client";

import type { Document } from "../../types";
import { putLibraryDoc } from "../../storage/contentApi";
import { writeThroughDoc } from "../../storage/fsSync";
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

function enqueuePathWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = pathWriteChains.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.catch(() => undefined);
  pathWriteChains.set(key, tail);
  void tail.then(() => {
    if (pathWriteChains.get(key) === tail) pathWriteChains.delete(key);
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
  return enqueuePathWrite(doc.path, () => writePrimary(get, set, doc, previousPath));
}

/** Fire-and-forget primary persist: same write, status reported on failure. */
export function scheduleContentPersist(
  get: () => LanghuanState,
  set: (p: Partial<LanghuanState>) => void,
  doc: Document | undefined,
  previousPath?: string
) {
  if (!doc) return;
  void persistContent(get, set, doc, previousPath).then((r) => {
    if (!r.ok) get().setStatus(`写入 content/ 失败：${r.message}`);
  });
}
