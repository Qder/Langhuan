"use client";
import { useIdeStore } from "@/lib/ide/store";

/** Prevent pointer focus from collapsing the CodeMirror selection before snapshotting. */
export function SelectionExplainAction({
  path,
  onExplain,
  onCite,
}: {
  path: string;
  onExplain: () => void;
  onCite?: () => void;
}) {
  const selection = useIdeStore((s) => s.selection);
  if (!selection?.text?.trim() || selection.path !== path) return null;
  return (
    <div className="absolute right-3 top-2 z-30 flex flex-col items-end gap-2">
      <button
        type="button"
        className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--chrome)] px-3 text-xs shadow-md"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onExplain}
      >
        讲解选区 · {selection.fromLine}–{selection.toLine} 行
      </button>
      {onCite && (
        <button
          type="button"
          className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--chrome)] px-3 text-xs shadow-md"
          onPointerDown={(e) => e.preventDefault()}
          onClick={onCite}
        >
          引用到笔记
        </button>
      )}
    </div>
  );
}
