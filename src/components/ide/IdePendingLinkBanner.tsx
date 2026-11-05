"use client";

import * as React from "react";
import { CornerDownRight, FolderOpen, X } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import { getIdeFsCapability } from "@/lib/ide/ideFs";
import { isSandboxSessionId } from "@/lib/ide/sandboxFs";
import {
  guessPendingProject,
  pendingLinkLocation,
} from "@/lib/ide/pendingLink";
import { IdeImportZipButton } from "./IdeImportZipButton";

/**
 * Shown on the 读码 welcome screen when a note's `[[ide:…]]` link arrived with
 * no project open. The link itself is persisted, so this banner survives a
 * reload instead of the click being a one-shot status flash.
 *
 * Ways out: reopen the guessed project, open a folder (desktop), or import zip
 * (Android). Dismissing forgets the link.
 */
export function IdePendingLinkBanner() {
  const pending = useIdeStore((s) => s.pendingIdeLink);
  const session = useIdeStore((s) => s.session);
  const recent = useIdeStore((s) => s.recent);
  const recentFiles = useIdeStore((s) => s.recentFiles);
  const openRecent = useIdeStore((s) => s.openRecent);
  const openFolder = useIdeStore((s) => s.openFolder);
  const clearPendingIdeLink = useIdeStore((s) => s.clearPendingIdeLink);

  const [busy, setBusy] = React.useState(false);

  const guess = React.useMemo(
    () =>
      pending ? guessPendingProject(pending, recentFiles, recent) : null,
    [pending, recentFiles, recent]
  );

  if (!pending) return null;

  const cap = getIdeFsCapability();
  const location = pendingLinkLocation(pending);
  const guessIsOpen = !!guess && guess.id === (session?.id ?? null);
  const hasProject = !!session;
  const guessCanOpen =
    !!guess &&
    !guessIsOpen &&
    (isSandboxSessionId(guess.id) || cap.canPickFolder);

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent)]/8 p-4 space-y-3"
      aria-label="待跳转的读码链接"
    >
      <div className="flex items-start gap-2">
        <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-serif font-semibold text-[var(--fg)]">
            {hasProject ? "这条笔记链接不在当前工程里" : "有一条笔记链接在等工程"}
          </p>
          <p className="text-xs font-ui text-[var(--muted)]">
            来自藏书阁的 <code className="text-[var(--fg)]">[[ide:…]]</code>
            {hasProject
              ? "，换到它所属的工程后会自动跳到这一行。"
              : "，打开下面的工程后会自动跳到这一行。"}
          </p>
          <p className="text-sm font-mono text-[var(--fg)] break-all">
            {location}
          </p>
          {guess && !guessIsOpen ? (
            <p className="text-xs font-ui text-[var(--muted)]">
              应该来自工程「{guess.name}」· {guess.pathLabel}
            </p>
          ) : hasProject ? (
            <p className="text-xs font-ui text-[var(--muted)]">
              当前工程「{session.name}」里没有这个文件，换一个工程试试。
            </p>
          ) : (
            <p className="text-xs font-ui text-[var(--muted)]">
              还不确定属于哪个工程，打开文件夹或导入 zip 试试。
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="忽略这条待跳转链接"
          title="忽略这条链接"
          disabled={busy}
          onClick={() => clearPendingIdeLink()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {guessCanOpen && (
          <Button
            variant="accent"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void run(() => openRecent(guess!.id))}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开该工程
          </Button>
        )}
        {cap.canPickFolder && (
          <Button
            variant={guess ? "ghost" : "accent"}
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void run(() => openFolder())}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {guess ? "换个文件夹…" : "打开文件夹…"}
          </Button>
        )}
        {cap.canImportZip && (
          <IdeImportZipButton
            variant={cap.canPickFolder || guessCanOpen ? "ghost" : "accent"}
            size="sm"
            label={guess ? "导入别的 zip…" : "导入工程 zip"}
          />
        )}
        <button
          type="button"
          className="text-xs font-ui text-[var(--muted)] hover:text-[var(--fg)] hover:underline"
          disabled={busy}
          onClick={() => clearPendingIdeLink()}
        >
          先不跳
        </button>
      </div>

      {!cap.canPickFolder && cap.folderHint && (
        <p className="text-xs font-ui text-[var(--muted)]">{cap.folderHint}</p>
      )}
    </section>
  );
}
