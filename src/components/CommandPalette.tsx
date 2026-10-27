"use client";

import * as React from "react";
import { Archive, ClipboardPaste, FilePlus2, FileText, FolderSync, Globe, History, Home, Moon, Search, Sun, Trash2 } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useStore } from "@/lib/store";
import { searchDocuments } from "@/lib/search";
import { titleOf, cn } from "@/lib/utils";
import { importClipboardAs } from "@/lib/clipboardImport";

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const documents = useStore((s) => s.documents);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const openHome = useStore((s) => s.requestOpenHome);
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const theme = useStore((s) => s.theme);
  const setBackupDialogOpen = useStore((s) => s.setBackupDialogOpen);
  const setFsSyncDialogOpen = useStore((s) => s.setFsSyncDialogOpen);
  const fsBoundName = useStore((s) => s.fsBoundName);
  const setVersionDialogOpen = useStore((s) => s.setVersionDialogOpen);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const autosaveEnabled = useStore((s) => s.autosaveEnabled);
  const setAutosaveEnabled = useStore((s) => s.setAutosaveEnabled);
  const activeId = useStore((s) => s.activeId);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const recent = [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const hits = q.trim() ? searchDocuments(documents, q) : [];

  type Item = { key: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };
  const items: Item[] = [];

  if (!q.trim()) {
    for (const d of recent) {
      items.push({
        key: "doc-" + d.id,
        label: titleOf(d.path),
        hint: d.path,
        icon: d.type === "html" ? <Globe className="h-4 w-4 text-[var(--teal)]" /> : <FileText className="h-4 w-4" />,
        run: () => openDoc(d.id),
      });
    }
    items.push(
      {
        key: "cmd-md",
        label: "新建 Markdown 笔记",
        icon: <FilePlus2 className="h-4 w-4 text-[var(--accent)]" />,
        run: () => createDoc({ type: "md" }),
      },
      {
        key: "cmd-html",
        label: "新建 HTML 页面",
        icon: <Globe className="h-4 w-4 text-[var(--teal)]" />,
        run: () => createDoc({ type: "html" }),
      },
      {
        key: "cmd-clip-md",
        label: "从剪贴板导入网页",
        hint: "HTML → Markdown 笔记",
        icon: <ClipboardPaste className="h-4 w-4 text-[var(--accent)]" />,
        run: () => {
          void (async () => {
            const res = await importClipboardAs("md");
            if (!res.ok) {
              setStatus(res.message);
              return;
            }
            const base = (res.doc.title || "剪藏笔记").replace(/[/\\?%*:|"<>]/g, "-");
            createDoc({
              type: "md",
              path: `剪藏/${base}.md`,
              content: res.doc.content,
            });
          })();
        },
      },
      {
        key: "cmd-clip-html",
        label: "保存 HTML 快照",
        hint: "剪贴板网页 → HTML 文档",
        icon: <ClipboardPaste className="h-4 w-4 text-[var(--teal)]" />,
        run: () => {
          void (async () => {
            const res = await importClipboardAs("html");
            if (!res.ok) {
              setStatus(res.message);
              return;
            }
            const base = (res.doc.title || "网页快照").replace(/[/\\?%*:|"<>]/g, "-");
            createDoc({
              type: "html",
              path: `剪藏/${base}.html`,
              content: res.doc.content,
            });
          })();
        },
      },
      {
        key: "cmd-theme",
        label: theme === "paper" ? "切换到墨色主题" : "切换到纸色主题",
        icon: theme === "paper" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />,
        run: () => toggleTheme(),
      },
      {
        key: "cmd-home",
        label: "回到首页",
        icon: <Home className="h-4 w-4" />,
        run: () => openHome(),
      },
      {
        key: "cmd-backup",
        label: "备份与恢复",
        hint: "导出 / 导入全库 zip",
        icon: <Archive className="h-4 w-4 text-[var(--accent)]" />,
        run: () => setBackupDialogOpen(true),
      },
      {
        key: "cmd-fs-sync",
        label: "本地文件夹同步",
        hint: fsBoundName ? `已绑定 ${fsBoundName}` : "File System Access",
        icon: <FolderSync className="h-4 w-4 text-[var(--teal)]" />,
        run: () => setFsSyncDialogOpen(true),
      },
      {
        key: "cmd-trash",
        label: "打开回收站",
        icon: <Trash2 className="h-4 w-4" />,
        run: () => setSidebarPanel("trash"),
      },
      {
        key: "cmd-versions",
        label: "版本历史",
        hint: activeId ? "当前文档" : "请先打开文档",
        icon: <History className="h-4 w-4" />,
        run: () => {
          if (activeId) setVersionDialogOpen(true);
          else setStatus("请先打开一篇文档");
        },
      },
      {
        key: "cmd-autosave",
        label: autosaveEnabled ? "关闭自动保存" : "开启自动保存",
        hint: "2 秒防抖写入",
        icon: <FilePlus2 className="h-4 w-4" />,
        run: () => setAutosaveEnabled(!autosaveEnabled),
      }
    );
  } else {
    for (const h of hits) {
      items.push({
        key: "hit-" + h.id,
        label: titleOf(h.path),
        hint: h.snippet,
        icon: h.type === "html" ? <Globe className="h-4 w-4 text-[var(--teal)]" /> : <FileText className="h-4 w-4" />,
        run: () => openDoc(h.id),
      });
    }
    if (hits.length === 0) {
      items.push({
        key: "create",
        label: `创建「${q.trim()}」`,
        hint: "新建 Markdown 笔记",
        icon: <FilePlus2 className="h-4 w-4 text-[var(--accent)]" />,
        run: () => createDoc({ type: "md", path: `${q.trim()}.md` }),
      });
    }
  }

  React.useEffect(() => setIdx(0), [q, open]);

  const runAt = (i: number) => {
    const item = items[i];
    if (!item) return;
    setOpen(false);
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((v) => Math.min(items.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(idx);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} className="max-w-xl overflow-hidden p-0" labelledBy="cmd-title">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
        <Search className="h-4 w-4 text-[var(--muted)]" />
        <input
          ref={inputRef}
          id="cmd-title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索文档、标签或运行命令…"
          className="h-12 flex-1 bg-transparent outline-none text-sm font-ui"
          aria-label="命令面板搜索"
        />
        <kbd className="text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">Esc</kbd>
      </div>
      <div className="max-h-[50vh] overflow-y-auto scroll-thin p-2">
        {!q.trim() && <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-[var(--muted)]">最近与命令</div>}
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onMouseEnter={() => setIdx(i)}
            onClick={() => runAt(i)}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
              i === idx ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" : "hover:bg-[var(--hover)]"
            )}
          >
            <span className="mt-0.5">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{item.label}</span>
              {item.hint && <span className="block text-xs text-[var(--muted)] truncate mt-0.5">{item.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
