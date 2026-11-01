"use client";

import * as React from "react";
import { Copy, FileCode2, X } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { resolveLibraryFileUrl } from "@/lib/storage/contentApi";
import { basename } from "@/lib/utils";

/**
 * 项目里的非文档文件（css / js / json…）只读查看。
 * 这些文件不进正文索引，所以不套用编辑器；需要改就改项目源文件再重新导入。
 *
 * 内容按需从 /api/library/file 取（Tauri 下走 data: URL），不做缓存。
 */
export function ProjectFileDialog({
  path,
  onClose,
  onCopied,
}: {
  path: string | null;
  onClose: () => void;
  onCopied?: (msg: string) => void;
}) {
  const [loaded, setLoaded] = React.useState<{ path: string; text: string } | null>(null);
  const [failure, setFailure] = React.useState<{ path: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let alive = true;
    (async () => {
      try {
        const url = await resolveLibraryFileUrl(path);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`读取失败 (${res.status})`);
        const body = await res.text();
        if (alive) setLoaded({ path, text: body });
      } catch (e) {
        if (alive) {
          setFailure({ path, message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  // 只认当前 path 的结果：换文件时旧内容不会被当成新文件显示
  const text = loaded && loaded.path === path ? loaded.text : null;
  const error = failure && failure.path === path ? failure.message : null;

  const lines = text ? text.split("\n") : [];

  return (
    <Dialog open={!!path} onClose={onClose} className="max-w-3xl">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <FileCode2 className="h-4 w-4 text-[var(--teal)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">
          {path ? basename(path) : ""}
        </span>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] ring-1 ring-[var(--border)]">
          项目文件 · 只读
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X className="h-4 w-4 text-[var(--muted)]" />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-auto px-4 py-3">
        {error ? (
          <p className="text-sm text-[var(--danger,#c0392b)]">{error}</p>
        ) : text == null ? (
          <p className="text-sm text-[var(--muted)]">读取中…</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--fg)]">
            {lines.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-9 shrink-0 select-none text-right text-[var(--muted)] opacity-50 tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{line || "\u00a0"}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
        <p className="text-[11px] text-[var(--muted)]">
          随项目导入的源文件，修改请编辑原文件后重新导入
        </p>
        <Button
          variant="outline"
          disabled={!text}
          onClick={() => {
            if (!text) return;
            void navigator.clipboard.writeText(text).then(
              () => onCopied?.(`已复制 ${basename(path || "")}`),
              () => onCopied?.("复制失败")
            );
          }}
        >
          <Copy className="mr-1 h-3.5 w-3.5" /> 复制
        </Button>
      </div>
    </Dialog>
  );
}
