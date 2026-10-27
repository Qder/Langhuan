"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { countWords, readingMinutes } from "@/lib/utils";

export function StatusBar() {
  const status = useStore((s) => s.status);
  const active = useStore((s) => s.getActive());
  const getContent = useStore((s) => s.getContent);
  const isDirty = useStore((s) => s.isDirty);
  const viewMode = useStore((s) => s.viewMode);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const editorCaret = useStore((s) => s.editorCaret);

  const content = active ? getContent(active.id) : "";
  const words = active ? countWords(content) : 0;
  const mins = readingMinutes(words);
  const dirty = active ? isDirty(active.id) : false;
  const showCaret =
    !!active &&
    !!editorCaret &&
    (viewMode === "source" || viewMode === "split");

  const htmlPreview =
    active?.type === "html" && viewMode !== "source" && !htmlImmersive;

  if (htmlImmersive && active?.type === "html") {
    return null;
  }

  if (htmlPreview) {
    return (
      <footer className="h-5 shrink-0 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_90%,transparent)] px-3 flex items-center justify-between text-[10px] text-[var(--muted)] font-ui">
        <div className="truncate">{status?.message || "就绪"}</div>
        <div className="flex items-center gap-3 shrink-0 tabular-nums">
          {showCaret && (
            <span>
              Ln {editorCaret!.line}, Col {editorCaret!.col}
            </span>
          )}
          <span>{words} 字</span>
          <span>沙箱渲染</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="h-7 shrink-0 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_90%,transparent)] px-3 flex items-center justify-between text-[11px] text-[var(--muted)] font-ui">
      <div className="truncate">{status?.message || "就绪"}</div>
      <div className="flex items-center gap-3 shrink-0 tabular-nums">
        {active && (
          <>
            {showCaret && (
              <span>
                Ln {editorCaret!.line}, Col {editorCaret!.col}
              </span>
            )}
            <span>{words} 字</span>
            <span>约 {mins} 分钟</span>
            <span>{dirty ? "未保存" : "已保存"}</span>
          </>
        )}
      </div>
    </footer>
  );
}
