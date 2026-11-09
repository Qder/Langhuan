"use client";

import { flushVisualEdit } from "../../previewVisualCaret";
import type { PendingNav } from "../../types";
import type { LanghuanState } from "../types";

export function softNavigate(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, next: NonNullable<PendingNav>) {
  const cur = get().activeId;
  if (cur && !flushVisualEdit(cur)) {
    get().setStatus("请先完成输入法组词，再切换文档");
    return;
  }
  if (cur && get().isDirty(cur)) {
    if (next.kind === "doc" && next.id === cur) return;
    set({ pendingNav: next });
    return;
  }
  if (next.kind === "home") get().openHome();
  else get().openDoc(next.id);
}
