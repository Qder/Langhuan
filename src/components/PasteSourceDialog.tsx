"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";

export type PasteSourceDialogProps = {
  open: boolean;
  onClose: () => void;
  /** When true, open the new doc after create (Sidebar). HomeView leaves this false. */
  openAfterCreate?: boolean;
};

function detectHtml(text: string): boolean {
  return /^\s*</.test(text) || /<\/?[a-z][\s\S]*>/i.test(text);
}

export function PasteSourceDialog({
  open,
  onClose,
  openAfterCreate = false,
}: PasteSourceDialogProps) {
  const createDoc = useStore((s) => s.createDoc);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setText("");
    setError(null);
    const t = window.setTimeout(() => taRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const submit = React.useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("请粘贴 Markdown 或 HTML 源码");
      return;
    }
    setError(null);
    const isHtml = detectHtml(trimmed);
    createDoc({
      type: isHtml ? "html" : "md",
      content: text,
      open: openAfterCreate,
    });
    onClose();
  }, [text, createDoc, openAfterCreate, onClose]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="paste-source-title" className="max-w-xl">
      <div className="p-5 space-y-3">
        <h2 id="paste-source-title" className="font-serif text-lg font-semibold">
          粘贴源码
        </h2>
        <p className="text-xs text-[var(--muted)]">
          粘贴 Markdown 或 HTML；将按内容自动识别类型并新建文档。
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs text-[var(--muted)]">源码</span>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={12}
            placeholder={"# 标题\n\n正文…\n\n或 <html>…</html>"}
            className="flex w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-mono text-[var(--fg)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35 min-h-[200px] resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        {error ? (
          <p className="text-xs text-[var(--accent)]" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-[11px] text-[var(--muted)]">⌘/Ctrl + Enter 提交</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" onClick={submit}>
            创建
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
