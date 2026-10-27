"use client";

import * as React from "react";
import { Archive } from "lucide-react";
import { useStore } from "@/lib/store";
import { BACKUP_REMIND_DAYS } from "@/lib/storage/constants";
import { Button } from "./ui/button";

export function BackupReminder() {
  const hydrated = useStore((s) => s.hydrated);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const setBackupDialogOpen = useStore((s) => s.setBackupDialogOpen);
  const documents = useStore((s) => s.documents);
  const [dismissed, setDismissed] = React.useState(false);

  const overdue =
    hydrated &&
    documents.length > 0 &&
    (lastBackupAt == null ||
      Date.now() - lastBackupAt >= BACKUP_REMIND_DAYS * 24 * 60 * 60 * 1000);

  if (!overdue || dismissed) return null;

  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-[60] w-[min(92vw,420px)] -translate-x-1/2">
      <div className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl">
        <Archive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">该备份藏书阁了</div>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {lastBackupAt == null
              ? "还没有导出过全库备份。清缓存或换浏览器会丢数据。"
              : `距离上次备份已超过 ${BACKUP_REMIND_DAYS} 天。`}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="accent"
              size="sm"
              onClick={() => {
                setBackupDialogOpen(true);
                setDismissed(true);
              }}
            >
              立即备份
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              稍后
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
