"use client";

import * as React from "react";
import { Dialog } from "../ui/dialog";
import { useIdeStore } from "@/lib/ide/store";
import { clampIdeLine } from "@/lib/ide/citations";
import { parseGotoLine } from "@/lib/ide/gotoLine";
import { Button } from "../ui/button";

export function IdeGotoLine({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const activePath = useIdeStore((s) => s.activePath);
  const tabs = useIdeStore((s) => s.tabs);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);
  const [value, setValue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setValue("");
    setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  const submit = async () => {
    if (!activePath) {
      setStatus("请先打开一个文件");
      return;
    }
    const parsed = parseGotoLine(value);
    if (!parsed) {
      setStatus("行号无效，请输入如 80 或 80:1");
      return;
    }
    const tab = tabs.find((t) => t.path === activePath);
    const lineCount = Math.max(1, (tab?.draft ?? "").split("\n").length);
    const line = clampIdeLine(parsed.line, lineCount);
    onClose();
    await openFile(activePath, { line });
    if (line !== parsed.line) {
      setStatus(`已夹到末行 ${line}`);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="ide-goto-line-title" className="max-w-sm p-4">
      <h2 id="ide-goto-line-title" className="text-sm font-ui font-semibold mb-2">
        转到行
      </h2>
      <p className="text-xs text-[var(--muted)] font-ui mb-3">
        输入行号，或 行:列（例如 80 或 80:1）
      </p>
      <input
        ref={inputRef}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
        value={value}
        placeholder={activePath ? "行号" : "请先打开文件"}
        disabled={!activePath}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={!activePath}>
          转到
        </Button>
      </div>
    </Dialog>
  );
}
