"use client";

import * as React from "react";
import { Tag, BookOpenCheck, Archive, HeartPulse, Replace, BookmarkPlus, CalendarDays, ClipboardPaste, Columns2, Download, FilePlus2, FileSearch, FileText, FolderOpen, FolderSync, Globe, History, Home, LayoutTemplate, ListTree, Network, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Maximize2, Blend, Code2, ScanSearch } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useStore } from "@/lib/store";
import { useIdeStore } from "@/lib/ide/store";
import { planSearchOpenReveal, searchDocuments } from "@/lib/search";
import { renderSnippetMarks } from "@/lib/search/highlight";
import { titleOf, cn } from "@/lib/utils";
import { importClipboardAs } from "@/lib/clipboardImport";
import { openCreateDocDialog } from "@/lib/createDocDialogBus";
import { requestToggleToc } from "@/lib/tocPanel";
import { insertTocMarker, planTocInsert } from "@/lib/tocMarker";
import { SaveSearchDialog } from "./BatchOpsDialogs";

/** Extra IDE-mode commands injected by IdeShell (kept out of the notes bundle). */
export type CommandPaletteIdeActions = {
  onQuickOpen: () => void;
  onWorkspaceSearch: () => void;
  onToggleExplain: () => void;
  onOpenFolder: () => void;
};

export function CommandPalette({
  ide,
}: {
  ide?: CommandPaletteIdeActions;
} = {}) {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const documents = useStore((s) => s.documents);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const requestPreviewLocate = useStore((s) => s.requestPreviewLocate);
  const openHome = useStore((s) => s.requestOpenHome);
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const setAppMode = useStore((s) => s.setAppMode);
  const appMode = useStore((s) => s.appMode);
  const requestSwitchToNotes = useIdeStore((s) => s.requestSwitchToNotes);
  const setBackupDialogOpen = useStore((s) => s.setBackupDialogOpen);
  const setFsSyncDialogOpen = useStore((s) => s.setFsSyncDialogOpen);
  const fsBoundName = useStore((s) => s.fsBoundName);
  const setVersionDialogOpen = useStore((s) => s.setVersionDialogOpen);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const setViewMode = useStore((s) => s.setViewMode);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const getActive = useStore((s) => s.getActive);
  const htmlInspectEnabled = useStore((s) => s.htmlInspectEnabled);
  const toggleHtmlInspectEnabled = useStore((s) => s.toggleHtmlInspectEnabled);

  const activeId = useStore((s) => s.activeId);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const setTemplateDialogOpen = useStore((s) => s.setTemplateDialogOpen);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);
  const setQuizReviewOpen = useStore((s) => s.setQuizReviewOpen);
  const setLinkHealthOpen = useStore((s) => s.setLinkHealthOpen);
  const setFindReplaceOpen = useStore((s) => s.setFindReplaceOpen);
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);
  const setClipUrlDialogOpen = useStore((s) => s.setClipUrlDialogOpen);
  const setPropsDialogOpen = useStore((s) => s.setPropsDialogOpen);
  const renameTagAcrossLibrary = useStore((s) => s.renameTagAcrossLibrary);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
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

  /**
   * Notes dialogs are mounted by the 藏书阁 shell only, but their open flags are
   * global store state — so flipping the mode and the flag together is enough;
   * the dialog mounts already open when <AppShell> swaps shells.
   */
  const inNotes = (fn: () => void) => () => {
    if (appMode === "ide") setAppMode("notes");
    fn();
  };

  if (!q.trim()) {
    if (ide) {
      items.push(
        {
          key: "ide-quick-open",
          label: "打开文件…",
          hint: "当前工程 · ⌘/Ctrl+P",
          icon: <FileSearch className="h-4 w-4 text-[var(--accent)]" />,
          run: () => ide.onQuickOpen(),
        },
        {
          key: "ide-workspace-search",
          label: "在工程中搜索…",
          hint: "只读 · ⌘/Ctrl+Shift+F",
          icon: <Search className="h-4 w-4 text-[var(--accent)]" />,
          run: () => ide.onWorkspaceSearch(),
        },
        {
          key: "ide-explain",
          label: "讲解当前文件",
          hint: "⌘/Ctrl+Shift+L",
          icon: <Sparkles className="h-4 w-4 text-[var(--accent)]" />,
          run: () => ide.onToggleExplain(),
        },
        {
          key: "ide-open-folder",
          label: "打开文件夹…",
          hint: "切换工程",
          icon: <FolderOpen className="h-4 w-4 text-[var(--teal)]" />,
          run: () => ide.onOpenFolder(),
        }
      );
    }
    for (const d of recent) {
      items.push({
        key: "doc-" + d.id,
        label: titleOf(d.path),
        hint: d.path,
        icon: d.type === "html" ? <Globe className="h-4 w-4 text-[var(--teal)]" /> : <FileText className="h-4 w-4" />,
        run: inNotes(() => openDoc(d.id)),
      });
    }
    items.push(
      {
        key: "cmd-md",
        label: "新建 Markdown 笔记",
        icon: <FilePlus2 className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => openCreateDocDialog({ type: "md" })),
      },
      {
        key: "cmd-html",
        label: "新建 HTML 页面",
        icon: <Globe className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => openCreateDocDialog({ type: "html" })),
      },
      {
        key: "cmd-clip-md",
        label: "从剪贴板导入网页",
        hint: "HTML → Markdown 笔记",
        icon: <ClipboardPaste className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => {
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
        }),
      },
      {
        key: "cmd-clip-html",
        label: "保存 HTML 快照",
        hint: "剪贴板网页 → HTML 文档",
        icon: <ClipboardPaste className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => {
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
        }),
      },
      {
        key: "cmd-home",
        label: "回到首页",
        icon: <Home className="h-4 w-4" />,
        run: inNotes(() => openHome()),
      },
      {
        key: "cmd-settings",
        label: "打开设置",
        hint: "主题 / 阅读 / 自动保存 / 快捷键",
        icon: <Settings2 className="h-4 w-4" />,
        run: inNotes(() => setSettingsDialogOpen(true)),
      },
      {
        key: "cmd-backup",
        label: "备份与恢复",
        hint: "导出 / 导入全库 zip",
        icon: <Archive className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setBackupDialogOpen(true)),
      },
      {
        key: "cmd-fs-sync",
        label: "本地文件夹同步",
        hint: fsBoundName ? `已绑定 ${fsBoundName}` : "File System Access",
        icon: <FolderSync className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => setFsSyncDialogOpen(true)),
      },
      {
        key: "cmd-trash",
        label: "打开回收站",
        icon: <Trash2 className="h-4 w-4" />,
        run: inNotes(() => setSidebarPanel("trash")),
      },
      {
        key: "cmd-versions",
        label: "版本历史",
        hint: activeId ? "当前文档" : "请先打开文档",
        icon: <History className="h-4 w-4" />,
        run: inNotes(() => {
          if (activeId) setVersionDialogOpen(true);
          else setStatus("请先打开一篇文档");
        }),
      },
      {
        key: "cmd-ide-mode",
        label: appMode === "ide" ? "切换到藏书阁" : "切换到读码",
        hint: "藏书阁 · 读码",
        icon: <Code2 className="h-4 w-4 text-[var(--accent)]" />,
        run: () => {
          if (appMode !== "ide") {
            setAppMode("ide");
            return;
          }
          // Leaving 读码 with unsaved tabs must go through the dirty guard.
          if (requestSwitchToNotes()) setAppMode("notes");
        },
      },
      {
        key: "cmd-daily",
        label: "今日笔记",
        hint: "按日期一键创建 / 打开",
        icon: <CalendarDays className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => openDailyNote()),
      },
      {
        key: "cmd-template",
        label: "从模板新建",
        hint: "会议 / 读书 / 周报…",
        icon: <LayoutTemplate className="h-4 w-4" />,
        run: inNotes(() => setTemplateDialogOpen(true)),
      },
      {
        key: "cmd-graph",
        label: "知识图谱",
        hint: "双链力导向图",
        icon: <Network className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => setGraphDialogOpen(true)),
      },
      {
        key: "cmd-link-health",
        label: "链接体检",
        hint: "失效双链 / 缺图 / 孤立 / 同名",
        icon: <HeartPulse className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setLinkHealthOpen(true)),
      },
      {
        key: "cmd-find-replace",
        label: "查找替换",
        hint: "字面量 · 当前/文件夹/全库",
        icon: <Replace className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setFindReplaceOpen(true)),
      },
      {
        key: "cmd-quiz-review",
        label: "待复习",
        hint: "HTML 题目：不会 / 未做",
        icon: <BookOpenCheck className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setQuizReviewOpen(true)),
      },
      {
        key: "cmd-clip-url",
        label: "网页剪藏（URL）",
        hint: "抓取正文或使用书签脚本",
        icon: <BookmarkPlus className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setClipUrlDialogOpen(true)),
      },
      {
        key: "cmd-props",
        label: "属性面板",
        hint: "标题 / 标签 / 状态 / 来源",
        icon: <SlidersHorizontal className="h-4 w-4" />,
        run: inNotes(() => {
          if (activeId) setPropsDialogOpen(true);
          else setStatus("请先打开一篇文档");
        }),
      },
      {
        key: "cmd-rename-tag",
        label: "重命名标签…",
        hint: "全库 YAML / keywords 一起改",
        icon: <Tag className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => {
          const from = window.prompt("要重命名的标签（旧名）");
          if (from === null) return;
          const to = window.prompt(`把「${from.trim()}」改成（新名）`);
          if (to === null) return;
          renameTagAcrossLibrary(from, to);
        }),
      },
      {
        key: "cmd-html-inspect",
        label: htmlInspectEnabled ? "关闭元素检视" : "开启元素检视",
        hint: htmlInspectEnabled
          ? "点击预览查看 HTML / 样式 / 行为"
          : "默认只阅读；开启后点击即查，也可 Alt+点击",
        icon: <ScanSearch className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => {
          const a = getActive();
          if (!a || a.type !== "html") {
            setStatus("元素检视只用于 HTML 预览");
            return;
          }
          toggleHtmlInspectEnabled();
        }),
      },
      {
        key: "cmd-view-mixed",
        label: "混合编辑模式",
        hint: "旧版块编辑；预览模式已支持就地编辑",
        icon: <Blend className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => {
          const a = getActive();
          if (!a || a.type !== "md") {
            setStatus("混合模式仅支持 Markdown");
            return;
          }
          setViewMode("mixed");
          setStatus("已切换到混合模式");
        }),
      },
      {
        key: "cmd-toc-insert",
        label: "插入目录",
        hint: "写入 <!-- toc -->，预览与导出渲染为可点目录",
        icon: <ListTree className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => {
          const a = getActive();
          if (!a) {
            setStatus("请先打开一篇文档");
            return;
          }
          if (a.type !== "md") {
            setStatus("文内目录只支持 Markdown");
            return;
          }
          const md = getContent(a.id);
          const plan = planTocInsert(md);
          if (plan.kind === "exists") {
            // 静默再来一次会得到两块一样的目录，比不插更糟。
            setStatus("这篇已经有目录标记了；要更新内容无需重插");
            return;
          }
          const next = insertTocMarker(md);
          setDraft(a.id, next.text);
          setStatus("已插入目录标记（预览里会渲染成可点目录）");
        }),
      },
      {
        key: "cmd-toc",
        label: "打开 / 关闭目录",
        hint: "Markdown 大纲（⌘/Ctrl+Shift+O）",
        icon: <ListTree className="h-4 w-4" />,
        run: inNotes(() => {
          const a = getActive();
          if (!a) {
            setStatus("请先打开一篇文档");
            return;
          }
          if (a.type !== "md") {
            setStatus("目录只支持 Markdown");
            return;
          }
          requestToggleToc();
        }),
      },
      {
        key: "cmd-md-focus",
        label: mdFocusMode ? "退出专注模式" : "专注模式",
        hint: "隐藏侧栏与顶栏（F）",
        icon: <Maximize2 className="h-4 w-4" />,
        run: inNotes(() => {
          const a = getActive();
          if (!a || a.type !== "md") {
            setStatus("专注模式仅支持 Markdown");
            return;
          }
          setMdFocusMode(!mdFocusMode);
        }),
      },

      {
        key: "cmd-export",
        label: "导出…",
        hint: "PDF / 独立 HTML / 静态站点",
        icon: <Download className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() => setExportDialogOpen(true)),
      },
      {
        key: "cmd-doc-split",
        label: secondaryId ? "关闭文档分屏" : "文档分屏",
        hint: "并排查看两篇（⌘\\）",
        icon: <Columns2 className="h-4 w-4 text-[var(--teal)]" />,
        run: inNotes(() => toggleDocSplit()),
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
        run: inNotes(() => {
          openDoc(h.id);
          const doc = documents.find((d) => d.id === h.id);
          if (!doc) return;
          const reveal = planSearchOpenReveal(doc.content, q);
          if (!reveal) return;
          applyLocateResult(
            {
              start: reveal.start,
              end: reveal.end,
              precision: "exact",
              message: `搜索命中 · ${titleOf(doc.path)}`,
            },
            { select: true, focus: true, highlight: true, center: true }
          );
          requestPreviewLocate(reveal.start, { scroll: true, announce: true });
        }),
      });
    }
    if (hits.length === 0) {
      items.push({
        key: "create",
        label: `创建「${q.trim()}」`,
        hint: "新建 Markdown 笔记",
        icon: <FilePlus2 className="h-4 w-4 text-[var(--accent)]" />,
        run: inNotes(() =>
          openCreateDocDialog({ type: "md", defaultName: q.trim() })
        ),
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
