"use client";
import { useIdeStore } from "@/lib/ide/store";

/** Prevent pointer focus from collapsing the CodeMirror selection before snapshotting. */
export function SelectionExplainAction({ path, onExplain }: { path: string; onExplain: () => void }) {
  const selection = useIdeStore((s) => s.selection);
  if (!selection?.text?.trim() || selection.path !== path) return null;
  return <button type="button" className="absolute right-3 top-2 z-30 min-h-10 rounded-lg border border-[var(--border)] bg-[var(--chrome)] px-3 text-xs shadow-md"
    onPointerDown={(e) => e.preventDefault()} onClick={onExplain}>
    讲解选区 · {selection.fromLine}–{selection.toLine} 行
  </button>;
}
