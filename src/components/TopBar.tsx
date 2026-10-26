"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Download,
  Menu,
  MoreHorizontal,
  Pencil,
  Save,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dropdown, DropdownItem } from "./ui/dropdown";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { basename, dirname, titleOf, cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";

export function TopBar() {
  const active = useStore((s) => s.getActive());
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const saveDoc = useStore((s) => s.saveDoc);
  const isDirty = useStore((s) => s.isDirty);
  const toggleStar = useStore((s) => s.toggleStar);
  const renameDoc = useStore((s) => s.renameDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const discardDraft = useStore((s) => s.discardDraft);
  const getContent = useStore((s) => s.getContent);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setStatus = useStore((s) => s.setStatus);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const dirty = active ? isDirty(active.id) : false;

  const modes: { id: ViewMode; label: string }[] = [
    { id: "preview", label: "预览" },
    { id: "split", label: "分栏" },
    { id: "source", label: "源码" },
  ];

  const exportDoc = () => {
    if (!active) return;
    const blob = new Blob([getContent(active.id)], {
      type: active.type === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = basename(active.path);
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`已导出 ${basename(active.path)}`);
  };

  const copySource = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(getContent(active.id));
    setStatus("已复制源码");
  };

  return (
    <>
      <header className="h-14 shrink-0 glass flex items-center gap-2 px-3 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="打开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          {active ? (
            <>
              <div className="min-w-0 truncate text-sm text-[var(--muted)] font-ui">
                {dirname(active.path) && <span>{dirname(active.path)} / </span>}
                <span className="font-serif font-bold text-[var(--fg)]">{titleOf(active.path)}</span>
              </div>
              {dirty && (
                <span className="shrink-0 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] px-2 py-0.5 border border-[var(--accent)]/20">
                  未保存
                </span>
              )}
            </>
          ) : (
            <div className="font-serif font-semibold">琅嬛 · 藏书阁</div>
          )}
        </div>

        {active && (
          <div
            className="hidden sm:inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
            role="tablist"
            aria-label="视图切换"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={viewMode === m.id}
                onClick={() => setViewMode(m.id)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-[10px] transition-colors font-ui",
                  viewMode === m.id ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--hover)]"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {active && (
          <Button
            variant={dirty ? "accent" : "outline"}
            size="sm"
            onClick={() => saveDoc(active.id)}
            aria-label="保存"
          >
            {dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {dirty ? "保存" : "已保存"}
          </Button>
        )}

        {active && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={active.starred ? "取消收藏" : "收藏"}
            onClick={() => toggleStar(active.id)}
          >
            <Star className={cn("h-4 w-4", active.starred && "fill-[var(--gold)] text-[var(--gold)]")} />
          </Button>
        )}

        {active && (
          <Dropdown
            align="right"
            trigger={
              <Button variant="ghost" size="icon" aria-label="更多">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          >
            <DropdownItem
              onClick={() => {
                setRenameVal(active.path);
                setRenameOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名 / 移动
            </DropdownItem>
            <DropdownItem onClick={exportDoc}>
              <Download className="h-3.5 w-3.5" /> 导出
            </DropdownItem>
            <DropdownItem onClick={copySource}>
              <Copy className="h-3.5 w-3.5" /> 复制源码
            </DropdownItem>
            <DropdownItem onClick={() => discardDraft(active.id)} disabled={!dirty}>
              <X className="h-3.5 w-3.5" /> 放弃修改
            </DropdownItem>
            <DropdownItem danger onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </DropdownItem>
          </Dropdown>
        )}

        <Button variant="ghost" size="icon" aria-label="搜索" onClick={() => setCommandOpen(true)}>
          <Search className="h-4 w-4" />
        </Button>
      </header>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} labelledBy="rename-title">
        <div className="p-5 space-y-3">
          <h2 id="rename-title" className="font-serif text-lg font-semibold">
            重命名 / 移动
          </h2>
          <p className="text-sm text-[var(--muted)]">路径里写 <code className="font-mono">/</code> 即可换目录，例如 <code className="font-mono">笔记/新名字.md</code></p>
          <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button
              variant="accent"
              onClick={() => {
                if (active && renameVal.trim()) {
                  renameDoc(active.id, renameVal.trim());
                  setRenameOpen(false);
                }
              }}
            >
              确定
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} labelledBy="delete-title">
        <div className="p-5 space-y-3">
          <h2 id="delete-title" className="font-serif text-lg font-semibold">确认删除？</h2>
          <p className="text-sm text-[var(--muted)]">
            将永久删除「{active ? titleOf(active.path) : ""}」，此操作不可撤销。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button
              variant="accent"
              onClick={() => {
                if (active) {
                  deleteDoc(active.id);
                  setDeleteOpen(false);
                }
              }}
            >
              删除
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
