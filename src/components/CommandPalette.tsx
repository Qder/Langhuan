"use client";

import * as React from "react";
import { Archive, BookmarkPlus, CalendarDays, ClipboardPaste, Columns2, Download, FilePlus2, FileText, FolderSync, Globe, History, Home, Keyboard, LayoutTemplate, Network, Palette, Search, SlidersHorizontal, Trash2, Maximize2, Blend, Type } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useStore } from "@/lib/store";
import { themeLabel } from "@/lib/theme";
import { searchDocuments } from "@/lib/search";
import { renderSnippetMarks } from "@/lib/search/highlight";
import { titleOf, cn } from "@/lib/utils";
import { importClipboardAs } from "@/lib/clipboardImport";
import { SaveSearchDialog } from "./BatchOpsDialogs";

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const documents = useStore((s) => s.documents);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const openHome = useStore((s) => s.requestOpenHome);
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setTheme = useStore((s) => s.setTheme);
  const theme = useStore((s) => s.theme);
  const setBackupDialogOpen = useStore((s) => s.setBackupDialogOpen);
  const setFsSyncDialogOpen = useStore((s) => s.setFsSyncDialogOpen);
  const fsBoundName = useStore((s) => s.fsBoundName);
  const setVersionDialogOpen = useStore((s) => s.setVersionDialogOpen);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const autosaveEnabled = useStore((s) => s.autosaveEnabled);
  const setAutosaveEnabled = useStore((s) => s.setAutosaveEnabled);
  const setViewMode = useStore((s) => s.setViewMode);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setReadingPrefs = useStore((s) => s.setReadingPrefs);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const getActive = useStore((s) => s.getActive);

  const activeId = useStore((s) => s.activeId);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const setTemplateDialogOpen = useStore((s) => s.setTemplateDialogOpen);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);
  const setClipUrlDialogOpen = useStore((s) => s.setClipUrlDialogOpen);
  const setPropsDialogOpen = useStore((s) => s.setPropsDialogOpen);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setShortcutsDialogOpen = useStore((s) => s.setShortcutsDialogOpen);
  const toggleDocSplit = useStore((s) => s.toggleDocSplit);
  const secondaryId = useStore((s) => s.secondaryId);
  const savedSearches = useStore((s) => s.savedSearches);
  const removeSavedSearch = useStore((s) => s.removeSavedSearch);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [saveSearch, setSaveSearch] = React.useState<{ query: string; defaultName: string } | null>(
    null
  );

  React.useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const recent = [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const hits = q.trim() ? searchDocuments(documents, q) : [];

  type Item = { key: string; label: string; hint?: React.ReactNode; icon: React.ReactNode; run: () => void; keepOpen?: boolean };
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
        key: "cmd-theme-cycle",
        label: "切换下一主题",
        hint: `当前：${themeLabel(theme)}`,
        icon: <Palette className="h-4 w-4" />,
        run: () => toggleTheme(),
      },
      {
        key: "cmd-theme-bamboo",
        label: "主题：青灯竹影",
        hint: theme === "bamboo" ? "当前" : "浅青灰 · 墨绿",
        icon: <Palette className="h-4 w-4" />,
        run: () => { setTheme("bamboo"); setStatus("已切换到青灯竹影"); },
      },
      {
        key: "cmd-theme-xuan",
        label: "主题：宣纸靛青",
        hint: theme === "xuan" ? "当前" : "宣纸白 · 靛青",
        icon: <Palette className="h-4 w-4" />,
        run: () => { setTheme("xuan"); setStatus("已切换到宣纸靛青"); },
      },
      {
        key: "cmd-theme-songyan",
        label: "主题：松烟月白",
        hint: theme === "songyan" ? "当前" : "深炭 · 月白",
        icon: <Palette className="h-4 w-4" />,
        run: () => { setTheme("songyan"); setStatus("已切换到松烟月白"); },
      },
      {
        key: "cmd-theme-jiang",
        label: "主题：绛帐缃帙",
        hint: theme === "jiang" ? "当前" : "暖米黄 · 绛紫",
        icon: <Palette className="h-4 w-4" />,
        run: () => { setTheme("jiang"); setStatus("已切换到绛帐缃帙"); },
      },
      {
        key: "cmd-theme-cyber",
        label: "主题：赛博藏经",
        hint: theme === "cyber" ? "当前" : "深底 · 青绿",
        icon: <Palette className="h-4 w-4" />,
        run: () => { setTheme("cyber"); setStatus("已切换到赛博藏经"); },
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
        key: "cmd-daily",
        label: "今日笔记",
        hint: "按日期一键创建 / 打开",
        icon: <CalendarDays className="h-4 w-4 text-[var(--accent)]" />,
        run: () => openDailyNote(),
      },
      {
        key: "cmd-template",
        label: "从模板新建",
        hint: "会议 / 读书 / 周报…",
        icon: <LayoutTemplate className="h-4 w-4" />,
        run: () => setTemplateDialogOpen(true),
      },
      {
        key: "cmd-graph",
        label: "知识图谱",
        hint: "双链力导向图",
        icon: <Network className="h-4 w-4 text-[var(--teal)]" />,
        run: () => setGraphDialogOpen(true),
      },
      {
        key: "cmd-clip-url",
        label: "网页剪藏（URL）",
        hint: "抓取正文或使用书签脚本",
        icon: <BookmarkPlus className="h-4 w-4 text-[var(--accent)]" />,
        run: () => setClipUrlDialogOpen(true),
      },
      {
        key: "cmd-props",
        label: "属性面板",
        hint: "标题 / 标签 / 状态 / 来源",
        icon: <SlidersHorizontal className="h-4 w-4" />,
        run: () => {
          if (activeId) setPropsDialogOpen(true);
          else setStatus("请先打开一篇文档");
        },
      },
      {
        key: "cmd-view-mixed",
        label: "混合编辑模式",
        hint: "块级所见即所得（Markdown）",
        icon: <Blend className="h-4 w-4 text-[var(--accent)]" />,
        run: () => {
          const a = getActive();
          if (!a || a.type !== "md") {
            setStatus("混合模式仅支持 Markdown");
            return;
          }
          setViewMode("mixed");
          setStatus("已切换到混合模式");
        },
      },
      {
        key: "cmd-md-focus",
        label: mdFocusMode ? "退出专注模式" : "专注模式",
        hint: "隐藏侧栏与顶栏（F）",
        icon: <Maximize2 className="h-4 w-4" />,
        run: () => {
          const a = getActive();
          if (!a || a.type !== "md") {
            setStatus("专注模式仅支持 Markdown");
            return;
          }
          setMdFocusMode(!mdFocusMode);
        },
      },
      {
        key: "cmd-font-larger",
        label: "增大阅读字号",
        hint: `当前 ${readingPrefs.fontSize}px`,
        icon: <Type className="h-4 w-4" />,
        run: () =>
          setReadingPrefs({
            fontSize: Math.min(24, readingPrefs.fontSize + 2),
          }),
      },
      {
        key: "cmd-font-smaller",
        label: "减小阅读字号",
        hint: `当前 ${readingPrefs.fontSize}px`,
        icon: <Type className="h-4 w-4" />,
        run: () =>
          setReadingPrefs({
            fontSize: Math.max(13, readingPrefs.fontSize - 2),
          }),
      },
      {
        key: "cmd-export",
        label: "导出…",
        hint: "PDF / 独立 HTML / 静态站点",
        icon: <Download className="h-4 w-4 text-[var(--accent)]" />,
        run: () => setExportDialogOpen(true),
      },
      {
        key: "cmd-doc-split",
        label: secondaryId ? "关闭文档分屏" : "文档分屏",
        hint: "并排查看两篇（⌘\\）",
        icon: <Columns2 className="h-4 w-4 text-[var(--teal)]" />,
        run: () => toggleDocSplit(),
      },
      {
        key: "cmd-shortcuts",
        label: "快捷键设置",
        hint: "自定义 ⌘K / 保存等",
        icon: <Keyboard className="h-4 w-4" />,
        run: () => setShortcutsDialogOpen(true),
      },
      {
        key: "cmd-autosave",
        label: autosaveEnabled ? "关闭自动保存" : "开启自动保存",
        hint: "2 秒防抖写入",
        icon: <FilePlus2 className="h-4 w-4" />,
        run: () => setAutosaveEnabled(!autosaveEnabled),
      }
    );
    for (const s of savedSearches) {
      items.push({
        key: "saved-" + s.id,
        label: `常用搜索：${s.name}`,
        hint: s.query,
        icon: <Search className="h-4 w-4 text-[var(--accent)]" />,
        keepOpen: true,
        run: () => setQ(s.query),
      });
    }
  } else {
    for (const h of hits) {
      items.push({
        key: "hit-" + h.id,
        label: titleOf(h.path),
        hint: renderSnippetMarks(h.snippet, h.marks),
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
    items.push({
      key: "save-search",
      label: "保存为常用搜索",
      hint: q.trim(),
      icon: <BookmarkPlus className="h-4 w-4 text-[var(--accent)]" />,
      keepOpen: true,
      run: () => {
        const query = q.trim();
        setSaveSearch({ query, defaultName: query.slice(0, 24) });
        setOpen(false);
      },
    });
  }

  React.useEffect(() => setIdx(0), [q, open]);

  const runAt = (i: number) => {
    const item = items[i];
    if (!item) return;
    item.run();
    if (!item.keepOpen) setOpen(false);
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
    <>
    <Dialog open={open} onClose={() => setOpen(false)} className="max-w-xl overflow-hidden p-0" labelledBy="cmd-title">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
        <Search className="h-4 w-4 text-[var(--muted)]" />
        <input
          ref={inputRef}
          id="cmd-title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索… 支持 tag:  path:  type:html|md"
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
      {saveSearch ? (
        <SaveSearchDialog
          open
          query={saveSearch.query}
          defaultName={saveSearch.defaultName}
          onClose={() => setSaveSearch(null)}
        />
      ) : null}
    </>
  );
}
