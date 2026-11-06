"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { formatCount, readingStatsOf, readingTimeLabel } from "@/lib/readingStats";

export function StatusBar() {
  const status = useStore((s) => s.status);
  const active = useStore((s) => s.getActive());
  const getContent = useStore((s) => s.getContent);
  const isDirty = useStore((s) => s.isDirty);
  const viewMode = useStore((s) => s.viewMode);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const editorCaret = useStore((s) => s.editorCaret);
  const hoverReveal = useStore((s) => s.hoverReveal);

  const content = active ? getContent(active.id) : "";
  // 与正文页、阅读弹层同一把尺子：去 YAML、去围栏代码，所以三处数字一致。
  const stats = React.useMemo(
    () => readingStatsOf(content, active?.type === "html" ? "html" : "md"),
    [content, active?.type]
  );
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
      <footer className="h-5 shrink-0 border-t border-[var(--chrome-border)] bg-[var(--chrome)] px-3 flex items-center justify-between text-[10px] text-[var(--muted)] font-ui">
        <div className="truncate">
          {hoverReveal?.degrade
            ? hoverReveal.message || "动态生成，无稳定源码行号"
            : hoverReveal?.label
              ? `源码 ${hoverReveal.label}`
              : status?.message || "就绪"}
        </div>
        <div className="flex items-center gap-3 shrink-0 tabular-nums">
          {showCaret && (
            <span>
              Ln {editorCaret!.line}, Col {editorCaret!.col}
            </span>
          )}
          <span>{formatCount(stats.chars)} 字</span>
          <span>沙箱渲染</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="h-7 max-lg:h-6 shrink-0 border-t border-[var(--chrome-border)] bg-[var(--chrome)] px-3 flex items-center justify-between text-[11px] max-lg:text-[10px] text-[var(--muted)] font-ui">
      <div className="truncate">
          {hoverReveal?.degrade
            ? hoverReveal.message || "动态生成，无稳定源码行号"
            : hoverReveal?.label
              ? `源码 ${hoverReveal.label}`
              : status?.message || "就绪"}
        </div>
      <div className="flex items-center gap-3 shrink-0 tabular-nums">
        {active && (
          <>
            {showCaret && (
              <span>
                Ln {editorCaret!.line}, Col {editorCaret!.col}
              </span>
            )}
            <span>{formatCount(stats.chars)} 字</span>
            <span className="hidden sm:inline">{readingTimeLabel(stats)}</span>
            <span>{dirty ? "未保存" : "已保存"}</span>
          </>
        )}
      </div>
    </footer>
  );
}
