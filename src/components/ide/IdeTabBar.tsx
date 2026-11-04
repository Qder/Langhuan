"use client";

import { X } from "lucide-react";
import { useIdeStore } from "@/lib/ide/store";
import { cn } from "@/lib/utils";

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function IdeTabBar() {
  const tabs = useIdeStore((s) => s.tabs);
  const activePath = useIdeStore((s) => s.activePath);
  const isDirty = useIdeStore((s) => s.isDirty);
  const requestCloseTab = useIdeStore((s) => s.requestCloseTab);

  if (tabs.length === 0) return null;

  return (
    <div
      className="lh-ide-tabbar flex items-stretch gap-0 overflow-x-auto border-b border-[var(--chrome-border)] bg-[var(--chrome)] px-1 shrink-0"
      role="tablist"
      aria-label="IDE 打开的文件"
    >
      {tabs.map((t) => {
        const active = t.path === activePath;
        const dirty = isDirty(t.path);
        return (
          <div
            key={t.path}
            role="tab"
            aria-selected={active}
            className={cn(
              "lh-ide-tab group relative flex items-center gap-1.5 max-w-[200px] h-9 max-lg:min-h-11 px-3 text-xs font-ui border-b-2 border-r border-r-[color-mix(in_srgb,var(--chrome-border)_80%,transparent)] cursor-pointer transition-colors",
              active
                ? "lh-ide-tab-active border-b-[var(--accent)] text-[var(--fg)] bg-[var(--bg)] font-medium"
                : "lh-ide-tab-inactive border-b-transparent text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
            )}
            onClick={() => useIdeStore.setState({ activePath: t.path })}
            title={t.path}
          >
            <span className="truncate">
              {dirty ? "● " : ""}
              {basename(t.path)}
            </span>
            <button
              type="button"
              className="opacity-60 hover:opacity-100 p-0.5 max-lg:p-2 rounded hover:bg-[var(--hover)] min-w-8 min-h-8 inline-flex items-center justify-center"
              aria-label={`关闭 ${basename(t.path)}`}
              onClick={(e) => {
                e.stopPropagation();
                requestCloseTab(t.path);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
