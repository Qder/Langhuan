"use client";

import { FolderOpen, BookOpen, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import { getIdeFsCapability } from "@/lib/ide/ideFs";
import { isSandboxSessionId } from "@/lib/ide/sandboxFs";
import { relativeTime } from "@/lib/utils";
import { IdeRecentFiles } from "./IdeRecentFiles";
import { IdePendingLinkBanner } from "./IdePendingLinkBanner";
import { IdeImportZipButton } from "./IdeImportZipButton";
import { IdeImportFolderButton } from "./IdeImportFolderButton";

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
            <BookOpen className="h-6 w-6" />
            <h1 className="font-serif text-2xl font-semibold text-[var(--fg)]">读码</h1>
          </div>
          <p className="text-sm text-[var(--muted)] font-ui leading-relaxed">
            打开本地工程 → 浏览源码 → 选中后讲解。工程只在本机打开，不会写入笔记库的{" "}
            <code className="text-[var(--fg)]">content/</code>。
          </p>
        </div>

        {cap.canOpenProject ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {cap.canImportSafFolder && (
                <IdeImportFolderButton variant="accent" size="lg" />
              )}
              {cap.canImportZip && (
                <IdeImportZipButton
                  variant={
                    cap.canPickFolder || cap.canImportSafFolder
                      ? "secondary"
                      : "accent"
                  }
                  size="lg"
                />
              )}
              {cap.canPickFolder && (
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
            </div>
            {cap.folderHint ? (
              <p className="text-sm text-[var(--muted)] font-ui leading-relaxed">
                {cap.folderHint}
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)] font-ui">
                桌面可直接选文件夹；安卓请把课件工程打成 zip 再导入（忽略{" "}
                <code className="text-[var(--fg)]">node_modules</code> 等，体积上限约
                40MB 文本）。
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-2">
            <p className="font-serif font-semibold">当前环境无法打开工程</p>
            <p className="text-sm text-[var(--muted)]">{cap.unsupportedHint}</p>
          </div>
        )}

        <IdePendingLinkBanner />

        <section className="space-y-3">
          <h2 className="text-xs font-ui uppercase tracking-wide text-[var(--muted)]">
            最近工程（最多 6 个）
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              暂无记录。打开文件夹、选择文件夹或导入 zip 后会出现在这里。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((r) => {
                const sandbox = isSandboxSessionId(r.id);
                const canReopen = sandbox || cap.canPickFolder;
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left disabled:opacity-50"
                      onClick={() => void openRecent(r.id)}
                      disabled={!canReopen}
                      title={
                        canReopen
                          ? undefined
                          : "此工程需要目录授权，请在桌面 Chrome / Edge 打开"
                      }
                    >
                      <div className="font-serif font-medium truncate">
                        {r.name}
                        {sandbox ? (
                          <span className="ml-1.5 text-[10px] font-ui font-normal text-[var(--muted)]">
                            已导入
                          </span>
                        ) : null}
                      </div>
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
                );
              })}
            </ul>
          )}
        </section>

        <IdeRecentFiles currentSessionId={null} />

        {status && (
          <p className="text-xs text-[var(--muted)] font-ui" role="status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
