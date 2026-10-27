"use client";

import * as React from "react";
import { History, RotateCcw } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import { listVersions } from "@/lib/storage/versions";
import { diffLines } from "@/lib/storage/diff";
import type { DocVersion } from "@/lib/types";
import { relativeTime, cn } from "@/lib/utils";

export function VersionHistoryDialog() {
  const open = useStore((s) => s.versionDialogOpen);
  const setOpen = useStore((s) => s.setVersionDialogOpen);
  const active = useStore((s) => s.getActive());
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const saveDoc = useStore((s) => s.saveDoc);
  const setStatus = useStore((s) => s.setStatus);
  const [versions, setVersions] = React.useState<DocVersion[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !active) {
      setVersions([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listVersions(active.id).then((list) => {
      if (cancelled) return;
      setVersions(list);
      setSelectedId(list[0]?.id ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, active]);

  const selected = versions.find((v) => v.id === selectedId) || null;
  const currentContent = active ? getContent(active.id) : "";
  const diff = selected ? diffLines(selected.content, currentContent) : [];

  const onRestore = () => {
    if (!active || !selected) return;
    // Save current as a version first via saveDoc path, then apply restored content
    setDraft(active.id, selected.content);
    saveDoc(active.id);
    setStatus(`已恢复到 ${relativeTime(selected.savedAt)} 的版本`);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      labelledBy="version-title"
      className="max-w-3xl"
    >
      <div className="p-5 space-y-3 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 id="version-title" className="font-serif text-lg font-semibold inline-flex items-center gap-2">
              <History className="h-5 w-5 text-[var(--accent)]" />
              版本历史
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              每次保存会留下快照（每篇最多 20 版）。选择版本可对比当前内容并恢复。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>

        {!active ? (
          <p className="text-sm text-[var(--muted)]">请先打开一篇文档。</p>
        ) : (
          <div className="flex gap-3 min-h-0 flex-1 overflow-hidden">
            <div className="w-48 shrink-0 overflow-y-auto scroll-thin rounded-xl border border-[var(--border)] p-1.5 space-y-0.5">
              {loading && (
                <div className="px-2 py-3 text-xs text-[var(--muted)]">加载中…</div>
              )}
              {!loading && versions.length === 0 && (
                <div className="px-2 py-3 text-xs text-[var(--muted)]">暂无历史版本</div>
              )}
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    "w-full rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    selectedId === v.id
                      ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                      : "hover:bg-[var(--hover)]"
                  )}
                >
                  <div className="font-medium">{relativeTime(v.savedAt)}</div>
                  <div className="text-[10px] text-[var(--muted)] tabular-nums mt-0.5">
                    {new Date(v.savedAt).toLocaleString("zh-CN")}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-[var(--muted)]">
                  {selected
                    ? "红色=版本中有 / 绿色=当前新增"
                    : "选择左侧版本查看差异"}
                </span>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!selected}
                  onClick={onRestore}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复此版本
                </Button>
              </div>
              <div className="flex-1 min-h-[240px] max-h-[50vh] overflow-auto scroll-thin rounded-xl border border-[var(--border)] bg-[var(--card)] font-mono text-[11px] leading-5">
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "px-2 whitespace-pre-wrap break-all",
                      line.type === "add" &&
                        "bg-[color-mix(in_srgb,#16a34a_14%,transparent)]",
                      line.type === "del" &&
                        "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]",
                      line.type === "same" && "text-[var(--muted)]"
                    )}
                  >
                    <span className="inline-block w-4 opacity-60 select-none">
                      {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                    </span>
                    {line.text || " "}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
