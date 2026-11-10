"use client";

import { FilePlus2, Highlighter } from "lucide-react";
import { Button } from "../ui/button";

/**
 * Always-visible (not hover-only) tablet entries for 批注 and 新建笔记.
 * Search and 目录 live in the same TopBar cluster as sibling buttons.
 */
export function TouchReaderActions({
  touchIcon,
  canAnnotate,
  onAnnotate,
  onNewNote,
}: {
  touchIcon: string;
  canAnnotate: boolean;
  onAnnotate: () => void;
  onNewNote: () => void;
}) {
  return (
    <div
      data-testid="touch-reader-actions"
      className="flex items-center gap-1 shrink-0"
    >
      {canAnnotate && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={touchIcon}
          aria-label="批注"
          title="选中文字后点此添加划线批注"
          onClick={onAnnotate}
        >
          <Highlighter className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={touchIcon}
        aria-label="新建笔记"
        title="新建笔记"
        onClick={onNewNote}
      >
        <FilePlus2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
