"use client";

export function ExplainViewControls({ fullscreen, onToggle, onCode }: {
  fullscreen: boolean; onToggle: () => void; onCode: () => void;
}) {
  return <div className="flex shrink-0 justify-between gap-2 border-b border-[var(--border)] px-2 text-xs font-ui">
    <button type="button" className="min-h-10 px-2" onClick={onCode}>返回代码</button>
    <button type="button" className="min-h-10 px-2" aria-pressed={fullscreen} onClick={onToggle}>
      {fullscreen ? "退出全屏讲解" : "全屏讲解"}
    </button>
  </div>;
}
