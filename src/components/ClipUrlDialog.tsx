"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { bookmarkletScript, fetchUrlAsMarkdown } from "@/lib/clipper";

export function ClipUrlDialog() {
  const open = useStore((s) => s.clipUrlDialogOpen);
  const setOpen = useStore((s) => s.setClipUrlDialogOpen);
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const bm = React.useMemo(() => bookmarkletScript(), []);

  const run = async () => {
    setBusy(true);
    setMsg("");
    const res = await fetchUrlAsMarkdown(url);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.message);
      return;
    }
    const base = res.title.replace(/[/\\?%*:|"<>]/g, "-");
    createDoc({ type: "md", path: `剪藏/${base}.md`, content: res.content });
    setOpen(false);
    setUrl("");
    setStatus(`已剪藏「${res.title}」`);
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="clip-title" className="max-w-lg">
      <div className="p-5 space-y-3">
        <h2 id="clip-title" className="font-serif text-lg font-semibold">
          网页剪藏
        </h2>
        <p className="text-sm text-[var(--muted)]">
          粘贴 URL 尝试抓取正文为 Markdown（许多站点会因跨域失败）。更稳妥：把下方书签拖到书签栏，在目标页点一下，再回琅嬛用「从剪贴板导入网页」。
        </p>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        {msg && <p className="text-xs text-[var(--accent)]">{msg}</p>}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 space-y-2">
          <div className="text-xs font-medium">书签剪藏脚本</div>
          <p className="text-[11px] text-[var(--muted)] break-all select-all font-mono leading-relaxed">
            {bm}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(bm);
              setStatus("已复制书签脚本，请新建书签并把地址粘贴为该脚本");
            }}
          >
            复制书签脚本
          </Button>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="accent" disabled={busy || !url.trim()} onClick={() => void run()}>
            {busy ? "抓取中…" : "抓取并新建"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
