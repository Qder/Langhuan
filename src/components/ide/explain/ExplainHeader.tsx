"use client";

import { Eraser, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "../../ui/button";

export function ExplainHeader({
  isMock,
  onToggleSettings,
  onClear,
  onClose,
}: {
  isMock: boolean;
  onToggleSettings: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="h-11 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--chrome-border)]">
      <Sparkles className="h-4 w-4 text-[var(--accent)] ml-1" />
      <div className="flex-1 min-w-0 font-ui text-sm font-medium">讲解</div>
      {isMock && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">
          未配置 API，这是本地示例讲解
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="设置"
        onClick={onToggleSettings}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="清空" onClick={onClear}>
        <Eraser className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="关闭讲解" onClick={onClose}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
