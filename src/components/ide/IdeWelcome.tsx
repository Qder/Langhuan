"use client";

import { FolderOpen, Code2, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import { getIdeFsCapability } from "@/lib/ide/ideFs";
import { relativeTime } from "@/lib/utils";

export function IdeWelcome() {
  const recent = useIdeStore((s) => s.recent);
  const openFolder = useIdeStore((s) => s.openFolder);
  const openRecent = useIdeStore((s) => s.openRecent);
  const removeRecent = useIdeStore((s) => s.removeRecent);
  const status = useIdeStore((s) => s.status);
  const cap = getIdeFsCapability();

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <Code2 className="h-6 w-6" />
            <h1 className="font-serif text-2xl font-semibold text-[var(--fg)]">IDE 模式</h1>
          </div>
          <p className="text-sm text-[var(--muted)] font-ui leading-relaxed">
            打开本地工程目录，像 VS Code 一样浏览与编辑源码（Java 优先，可扩展 C++ 等）。
            工程与笔记库分开，不会写入 <code className="text-[var(--fg)]">content/</code>。
          </p>
        </div>

        {!cap.canPickFolder ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-2">
            <p className="font-serif font-semibold">当前环境无法选择磁盘文件夹</p>
            <p className="text-sm text-[var(--muted)]">{cap.unsupportedHint}</p>
          </div>
        ) : (
          <Button
            variant="accent"
            size="lg"
            className="gap-2"
            onClick={() => void openFolder()}
          >
            <FolderOpen className="h-4 w-4" />
            打开文件夹
          </Button>
        )}

        <section className="space-y-3">
          <h2 className="text-xs font-ui uppercase tracking-wide text-[var(--muted)]">
            最近工程（最多 6 个）
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">暂无记录。打开一个文件夹后会出现在这里。</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => void openRecent(r.id)}
                    disabled={!cap.canPickFolder}
                  >
                    <div className="font-serif font-medium truncate">{r.name}</div>
                    <div className="text-xs text-[var(--muted)] truncate">
                      {r.pathLabel}
                      {r.lastOpenedAt ? ` · ${relativeTime(r.lastOpenedAt)}` : ""}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`从最近列表移除 ${r.name}`}
                    onClick={() => void removeRecent(r.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {status && (
          <p className="text-xs text-[var(--muted)] font-ui" role="status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
