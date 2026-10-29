"use client";

import type { PendingNav } from "../../types";
import type { LanghuanState } from "../types";

export function softNavigate(get: () => LanghuanState, set: (p: Partial<LanghuanState>) => void, next: NonNullable<PendingNav>) {
  const cur = get().activeId;
  if (cur && get().isDirty(cur)) {
    if (next.kind === "doc" && next.id === cur) return;
    set({ pendingNav: next });
    return;
  }
  if (next.kind === "home") get().openHome();
  else get().openDoc(next.id);
}
