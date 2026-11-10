"use client";
import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import { Dialog } from "../ui/dialog";

export function IdeImportReport() {
  const report = useIdeStore((s) => s.importReport);
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  if (!report?.length) return null;
  return <>
    <button type="button" className="min-h-10 px-2 text-xs text-[var(--accent)]" onClick={() => setOpen(true)}>导入详情（跳过 {report.length}）</button>
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy={id}>
      <div className="p-4 space-y-3">
        <h2 id={id}>工程导入 · 跳过文件详情</h2>
        <ul className="space-y-2 text-xs">{report.map((item, i) => <li key={i} className="break-all"><code>{item.path}</code> — {item.reason}</li>)}</ul>
        <button type="button" className="min-h-10" onClick={() => setOpen(false)}>关闭详情</button>
      </div>
    </Dialog>
  </>;
}
