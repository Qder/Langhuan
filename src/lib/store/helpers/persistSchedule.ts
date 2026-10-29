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
    .catch(() => {
      /* best-effort optional mirror */
    });
}

/** Primary persist: write doc into repo content/ via API; optionally mirror to bound FS folder. */
export function scheduleContentPersist(
  get: () => LanghuanState,
  set: (p: Partial<LanghuanState>) => void,
  doc: Document | undefined,
  previousPath?: string
) {
  if (!doc) return;
  void putLibraryDoc(doc, previousPath)
    .then(() => {
      /* content/ is source of truth */
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      get().setStatus(`写入 content/ 失败：${msg}`);
    });
  scheduleWriteThrough(get, set, doc);
}
