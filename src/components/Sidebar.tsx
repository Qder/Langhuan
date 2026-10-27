"use client";

import * as React from "react";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Star,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dropdown, DropdownItem } from "./ui/dropdown";
import { useStore, filteredDocuments } from "@/lib/store";
import { collectTagCounts } from "@/lib/tags";
import { dirname, titleOf, cn } from "@/lib/utils";
import { ImportFolderDialog } from "./ImportFolderDialog";
import { importClipboardAs } from "@/lib/clipboardImport";
import { IMPORTABLE_ACCEPT, isImportableLibraryPath } from "@/lib/importable";
import { ResizeGutter } from "./ui/ResizeGutter";
import { useMediaQuery } from "@/lib/useMediaQuery";

type TreeNode = {
  name: string;
  path: string;
  docs: { id: string; name: string; type: string; starred?: boolean }[];
  children: Map<string, TreeNode>;
};

function buildTree(
  docs: { id: string; path: string; type: string; starred?: boolean }[]
) {
  const root: TreeNode = { name: "", path: "", docs: [], children: new Map() };
  for (const d of docs) {
    const parts = d.path.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.children.has(name)) {
        node.children.set(name, { name, path: p, docs: [], children: new Map() });
      }
      node = node.children.get(name)!;
    }
    node.docs.push({
      id: d.id,
      name: parts[parts.length - 1],
      type: d.type,
      starred: d.starred,
    });
  }
  return root;
}

function countDocs(node: TreeNode): number {
  let n = node.docs.length;
  for (const c of node.children.values()) n += countDocs(c);
  return n;
}

function ancestorsOf(path: string): string[] {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
}

function FileTree({
  node,
  depth = 0,
  expanded,
  onToggle,
  compact,
  activeId,
  rowH,
}: {
  node: TreeNode;
  depth?: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  compact: boolean;
  activeId: string | null;
  rowH: string;
}) {
  const openDoc = useStore((s) => s.openDoc);
  const isDirty = useStore((s) => s.isDirty);
  const folders = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh")
  );
  const files = [...node.docs].sort((a, b) => a.name.localeCompare(b.name, "zh"));

  void compact;
  const deep = depth > 3;

  return (
    <div
      className={cn(depth > 0 && "border-l border-[var(--border)]")}
      style={depth > 0 ? { marginLeft: 12, paddingLeft: 8 } : undefined}
    >
      {deep && depth === 4 && (
        <div className="px-2 text-[10px] text-[var(--muted)] leading-none py-1">…</div>
      )}
      {folders.map((f) => {
        const open = expanded.has(f.path);
        return (
          <div key={f.path} className="mb-0.5">
            <button
              type="button"
              onClick={() => onToggle(f.path)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 rounded-xl px-2 text-sm hover:bg-[var(--hover)]",
                rowH
              )}
              aria-expanded={open}
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 text-[var(--muted)] transition-transform",
                  !open && "-rotate-90"
                )}
              />
              <FolderOpen className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
              <span className="truncate font-ui">{f.name}</span>
              <span className="ml-auto text-[10px] text-[var(--muted)] tabular-nums">
                {countDocs(f)}
              </span>
            </button>
            {open && (
              <FileTree
                node={f}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                compact={compact}
                activeId={activeId}
                rowH={rowH}
              />
            )}
          </div>
        );
      })}
      {files.map((f) => {
        const active = f.id === activeId;
        const dirty = isDirty(f.id);
        return (
          <button
            key={f.id}
            type="button"
            data-tree-id={f.id}
            onClick={() => openDoc(f.id)}
            className={cn(
              "relative flex w-full items-center gap-1.5 rounded-xl px-2 text-left text-sm transition-colors",
              rowH,
              active
                ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                : "hover:bg-[var(--hover)]"
            )}
          >
            {active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--accent)]" />
            )}
            {f.type === "html" ? (
              <Globe className="h-3.5 w-3.5 text-[var(--teal)] shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" />
            )}
            <span className="truncate font-ui min-w-0 flex-1">{titleOf(f.name)}</span>
            {f.starred && (
              <Star
                className="h-3 w-3 shrink-0 fill-[var(--gold)] text-[var(--gold)]"
                aria-label="已收藏"
              />
            )}
            {dirty && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0"
                aria-label="未保存"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}

export function Sidebar() {
  const documents = useStore((s) => s.documents);
  const tagFilters = useStore((s) => s.tagFilters);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const clearTagFilters = useStore((s) => s.clearTagFilters);
  const openHome = useStore((s) => s.openHome);
  const activeId = useStore((s) => s.activeId);
  const createDoc = useStore((s) => s.createDoc);
  const setStatus = useStore((s) => s.setStatus);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const openDoc = useStore((s) => s.openDoc);
  const sidebarPanel = useStore((s) => s.sidebarPanel);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const htmlSidebarPeek = useStore((s) => s.htmlSidebarPeek);
  const setHtmlSidebarPeek = useStore((s) => s.setHtmlSidebarPeek);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [tagQuery, setTagQuery] = React.useState("");
  const [pendingImport, setPendingImport] = React.useState<
    { path: string; content: string }[] | null
  >(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());

  const compact = useMediaQuery("(max-height: 699px)");
  const rowH = compact ? "h-7" : "h-8"; // 28 / 32

  const visible = filteredDocuments(documents, tagFilters);
  const tags = collectTagCounts(documents);
  const sortedTags = [...tags.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")
  );
  const tagQ = tagQuery.trim().toLowerCase();
  const filteredTags = tagQ
    ? sortedTags.filter(([name]) => name.toLowerCase().includes(tagQ))
    : sortedTags;
  const starred = documents
    .filter((d) => d.starred)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const tree = buildTree(
    visible.map((d) => ({
      id: d.id,
      path: d.path,
      type: d.type,
      starred: d.starred,
    }))
  );
  const bytes = useStore((s) => s.storageBytes)();
  const activeDoc = documents.find((d) => d.id === activeId) || null;
  const pathHint = activeDoc
    ? dirname(activeDoc.path) || "根目录"
    : tagFilters.length
      ? `筛选 · ${tagFilters.map((t) => `#${t}`).join(" ")}`
      : "全部文档";

  // Auto-expand ancestors of active doc
  React.useEffect(() => {
    if (!activeDoc) return;
    const anc = ancestorsOf(activeDoc.path);
    if (!anc.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const p of anc) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeDoc]);

  // Expand all top-level folders on first mount for empty expanded set with docs
  React.useEffect(() => {
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const f of tree.children.keys()) {
        const node = tree.children.get(f)!;
        next.add(node.path);
      }
      return next;
    });
    // only on documents identity change when empty — intentional once-ish seed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.length]);

  // Scroll active row into view (center of middle pane)
  React.useEffect(() => {
    if (!activeId || sidebarPanel !== "docs") return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-tree-id="${activeId}"]`) as HTMLElement | null;
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [activeId, sidebarPanel, expanded]);

  const onToggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onPasteSource = () => {
    const text = window.prompt("粘贴 Markdown 或 HTML 源码：");
    if (text == null || !text.trim()) return;
    const isHtml = /^\s*</.test(text) || /<\/?[a-z][\s\S]*>/i.test(text);
    createDoc({ type: isHtml ? "html" : "md", content: text, open: true });
  };

  const onClipperMd = async () => {
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
      open: true,
    });
  };

  const onClipperHtml = async () => {
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
      open: true,
    });
  };

  const handleImportList = async (list: FileList | File[], keepDir: boolean) => {
    const files: { path: string; content: string }[] = [];
    for (const file of Array.from(list)) {
      const path = keepDir
        ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        : file.name;
      if (!isImportableLibraryPath(path)) continue;
      files.push({ path, content: await readFileAsText(file) });
    }
    if (files.length) setPendingImport(files);
  };

  const openLocalFolder = async () => {
    const w = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (!w.showDirectoryPicker) {
      folderRef.current?.click();
      return;
    }
    try {
      const dir = await w.showDirectoryPicker();
      const collected: { path: string; content: string }[] = [];
      const walk = async (handle: FileSystemDirectoryHandle, prefix: string) => {
        // @ts-expect-error async iterator
        for await (const [name, entry] of handle.entries()) {
          if (entry.kind === "file" && isImportableLibraryPath(name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            collected.push({
              path: prefix ? `${prefix}/${name}` : name,
              content: await file.text(),
            });
          } else if (entry.kind === "directory") {
            await walk(
              entry as FileSystemDirectoryHandle,
              prefix ? `${prefix}/${name}` : name
            );
          }
        }
      };
      await walk(dir, "");
      if (collected.length) setPendingImport(collected);
    } catch {
      /* cancelled */
    }
  };

  const toggleTag = (name: string) => {
    // Stay on tags panel so multi-select is easy; docs panel still shows chips.
    toggleTagFilter(name);
  };

  const segments: { id: "docs" | "tags" | "stars"; label: string; count: number }[] = [
    { id: "docs", label: "文档", count: visible.length },
    { id: "tags", label: "标签", count: tags.size },
    { id: "stars", label: "收藏", count: starred.length },
  ];

  const panel = (
    <aside
      className={cn(
        "flex h-full w-full flex-col overflow-hidden border-r border-[var(--border)]",
        "bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] backdrop-blur-md"
      )}
    >
      {/* —— Top fixed ≤132px —— */}
      <div
        className={cn(
          "shrink-0 px-3 pt-2 pb-2 space-y-1.5",
          compact && "pt-1.5 pb-1.5 space-y-1"
        )}
      >
        <div className={cn("flex items-center gap-2", compact ? "h-8" : "h-10")}>
          <button
            type="button"
            onClick={openHome}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-0.5 hover:bg-[var(--hover)] transition-colors text-left"
            aria-label="回到首页"
          >
            <span
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white font-serif font-bold shadow-sm",
                compact ? "h-7 w-7 text-sm" : "h-8 w-8 text-base"
              )}
              style={{ transform: "rotate(-6deg)" }}
            >
              琅
            </span>
            <span className="min-w-0">
              <span className="block font-serif text-base leading-none truncate">琅嬛</span>
              {!compact && (
                <span className="block text-[10px] tracking-[0.22em] text-[var(--muted)] mt-0.5">
                  LANGHUAN
                </span>
              )}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("shrink-0", compact ? "h-7 w-7" : "h-8 w-8")}
            onClick={toggleTheme}
            aria-label={theme === "paper" ? "切换到墨色" : "切换到纸色"}
          >
            {theme === "paper" ? (
              <Moon className="h-3.5 w-3.5" />
            ) : (
              <Sun className="h-3.5 w-3.5" />
            )}
          </Button>
          {compact && (
            <span className="shrink-0 text-[10px] text-[var(--muted)] tabular-nums pr-1">
              {(bytes / 1024).toFixed(0)}K
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-2.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] transition-colors",
            compact ? "h-8" : "h-9"
          )}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-0 truncate text-left">搜索文档、标签、命令…</span>
          <kbd className="shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono leading-none">
            ⌘K
          </kbd>
        </button>

        <div className={cn("flex gap-2", compact ? "h-8" : "h-9")}>
          <Dropdown
            trigger={
              <Button
                variant="accent"
                className={cn("flex-1 min-w-0", compact ? "h-8" : "h-9")}
                aria-label="新建"
              >
                新建 <ChevronDown className="h-3.5 w-3.5 opacity-80 shrink-0" />
              </Button>
            }
          >
            <DropdownItem onClick={() => createDoc({ type: "md" })}>Markdown 笔记</DropdownItem>
            <DropdownItem onClick={() => createDoc({ type: "html" })}>HTML 页面</DropdownItem>
            <DropdownItem onClick={onPasteSource}>粘贴源码</DropdownItem>
            <DropdownItem onClick={() => void onClipperMd()}>从剪贴板导入网页</DropdownItem>
            <DropdownItem onClick={() => void onClipperHtml()}>保存 HTML 快照</DropdownItem>
          </Dropdown>
          <Dropdown
            trigger={
              <Button
                variant="secondary"
                className={cn("flex-1 min-w-0", compact ? "h-8" : "h-9")}
                aria-label="导入"
              >
                导入 <ChevronDown className="h-3.5 w-3.5 opacity-80 shrink-0" />
              </Button>
            }
          >
            <DropdownItem onClick={() => folderRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> 导入文件夹
            </DropdownItem>
            <DropdownItem onClick={() => fileRef.current?.click()}>
              <FileText className="h-3.5 w-3.5" /> 导入文件
            </DropdownItem>
            <DropdownItem onClick={openLocalFolder}>
              <FolderOpen className="h-3.5 w-3.5" /> 打开本地文件夹
            </DropdownItem>
          </Dropdown>
        </div>
        <input
          ref={folderRef}
          type="file"
          className="hidden"
          multiple
          // @ts-expect-error webkitdirectory
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files) void handleImportList(e.target.files, true);
            e.target.value = "";
          }}
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          accept={IMPORTABLE_ACCEPT}
          onChange={(e) => {
            if (e.target.files) void handleImportList(e.target.files, false);
            e.target.value = "";
          }}
        />
      </div>

      {/* —— Middle: only scroll region —— */}
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-1">
        <div
          className={cn(
            "shrink-0 grid grid-cols-3 gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-0.5 mb-1.5",
            compact ? "h-7" : "h-8"
          )}
          role="tablist"
          aria-label="侧栏面板"
        >
          {segments.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={sidebarPanel === s.id}
              onClick={() => setSidebarPanel(s.id)}
              className={cn(
                "rounded-[10px] text-[11px] font-ui truncate px-1 transition-colors",
                sidebarPanel === s.id
                  ? "bg-[var(--accent)] text-white"
                  : "hover:bg-[var(--hover)] text-[var(--muted)]"
              )}
            >
              {s.label}
              <span className="ml-0.5 tabular-nums opacity-80">{s.count}</span>
            </button>
          ))}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {sidebarPanel === "docs" && (
            <div>
              {tagFilters.length > 0 && (
                <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-1 rounded-lg border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-elevated))] px-2 py-1 text-xs text-[var(--accent)]">
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-x-auto scroll-thin">
                    {tagFilters.map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-label={`移除标签 ${t}`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--accent)]/35 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--hover)]"
                        onClick={() => toggleTagFilter(t)}
                      >
                        #{t}
                        <X className="h-2.5 w-2.5 opacity-80" />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="清除全部标签筛选"
                    className="shrink-0 rounded p-0.5 hover:bg-[var(--hover)]"
                    onClick={() => clearTagFilters()}
                    title="清除全部"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="sticky top-0 z-[9] mb-1 rounded-lg bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] px-2 py-1 text-[11px] text-[var(--muted)] truncate backdrop-blur-sm">
                {pathHint}
              </div>
              <FileTree
                node={tree}
                expanded={expanded}
                onToggle={onToggleFolder}
                compact={compact}
                activeId={activeId}
                rowH={rowH}
              />
            </div>
          )}

          {sidebarPanel === "tags" && (
            <div className="space-y-2 px-0.5 pb-2">
              <input
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                placeholder="筛选标签…"
                aria-label="筛选标签"
                className={cn(
                  "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-ui text-[var(--fg)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35",
                  compact ? "h-7" : "h-8"
                )}
              />
              <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
                <button
                  type="button"
                  onClick={() => clearTagFilters()}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs border transition-colors whitespace-nowrap",
                    tagFilters.length === 0
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                      : "border-[var(--border)] hover:bg-[var(--hover)]"
                  )}
                >
                  全部 · {documents.length}
                </button>
                {tagFilters.length > 0 && (
                  <span className="shrink-0 self-center text-[10px] text-[var(--muted)] tabular-nums">
                    已选 {tagFilters.length} · 文档 {visible.length}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {filteredTags.map(([name, n]) => {
                  const selected = tagFilters.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(name)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs border transition-colors truncate text-left",
                        selected
                          ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                          : "border-[var(--border)] hover:bg-[var(--hover)]"
                      )}
                      title={`${name} · ${n}${selected ? "（已选）" : ""}`}
                    >
                      {name} · {n}
                    </button>
                  );
                })}
              </div>
              {filteredTags.length === 0 && (
                <div className="text-xs text-[var(--muted)] px-1 py-4 text-center">无匹配标签</div>
              )}
            </div>
          )}

          {sidebarPanel === "stars" && (
            <div className="space-y-0.5 pb-2">
              {starred.length === 0 && (
                <div className="text-xs text-[var(--muted)] px-2 py-6 text-center">
                  还没有收藏。在顶栏点星标即可。
                </div>
              )}
              {starred.map((d) => {
                const folder = dirname(d.path) || "根目录";
                const active = d.id === activeId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => openDoc(d.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-2 text-left text-sm",
                      rowH,
                      active
                        ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                        : "hover:bg-[var(--hover)]"
                    )}
                  >
                    <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--gold)] text-[var(--gold)]" />
                    <span className="truncate min-w-0 flex-1">{titleOf(d.path)}</span>
                    <span className="shrink-0 max-w-[42%] truncate text-[10px] text-[var(--muted)]">
                      {folder}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* —— Bottom fixed 40px —— */}
      {!compact && (
        <div className="h-10 shrink-0 border-t border-[var(--border)] px-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--muted)] leading-tight">
            <div>本地存储</div>
            <div className="tabular-nums">{(bytes / 1024).toFixed(1)} KB</div>
          </div>
        </div>
      )}
    </aside>
  );

  const htmlRail =
    !!activeDoc && activeDoc.type === "html" && !htmlImmersive;

  // Close peek when leaving HTML
  React.useEffect(() => {
    if (!htmlRail) setHtmlSidebarPeek(false);
  }, [htmlRail, setHtmlSidebarPeek]);

  const rail = (
    <div
      className="hidden md:flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] py-2"
    >
      <button
        type="button"
        onClick={openHome}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--hover)]"
        aria-label="首页"
        title="首页"
      >
        <Home className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--hover)]"
        aria-label="搜索"
        title="搜索 ⌘K"
      >
        <Search className="h-4 w-4" />
      </button>
      <Dropdown
        trigger={
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white hover:opacity-90"
            aria-label="新建"
            title="新建"
          >
            <Plus className="h-4 w-4" />
          </button>
        }
      >
        <DropdownItem onClick={() => createDoc({ type: "md" })}>Markdown 笔记</DropdownItem>
        <DropdownItem onClick={() => createDoc({ type: "html" })}>HTML 页面</DropdownItem>
        <DropdownItem onClick={onPasteSource}>粘贴源码</DropdownItem>
      </Dropdown>
      <button
        type="button"
        onClick={() => setHtmlSidebarPeek(true)}
        className="mt-auto inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--hover)]"
        aria-label="展开侧栏"
        title="展开侧栏"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      {/* HTML: 56px icon rail (does not squeeze when overlay opens) */}
      {htmlRail ? (
        <>
          {rail}
          {/* Left-edge hover strip to peek */}
          <div
            className="pointer-events-auto fixed left-0 top-0 z-40 hidden h-dvh w-1.5 md:block"
            onMouseEnter={() => setHtmlSidebarPeek(true)}
          />
          {htmlSidebarPeek && (
            <div className="fixed inset-0 z-50 hidden md:flex">
              <div
                className="h-full shadow-2xl animate-enter"
                style={{ width: sidebarWidth }}
                onMouseLeave={() => setHtmlSidebarPeek(false)}
              >
                {panel}
              </div>
              <div
                className="h-full flex-1 bg-black/20"
                onClick={() => setHtmlSidebarPeek(false)}
              />
            </div>
          )}
        </>
      ) : htmlImmersive ? null : (
        <>
          <div
            className="hidden md:flex h-full shrink-0 overflow-hidden"
            style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
          >
            {panel}
          </div>
          <ResizeGutter
            className="hidden md:flex"
            axis="horizontal"
            label="调整侧栏宽度"
            value={sidebarWidth}
            min={240}
            max={360}
            onDelta={(d) => {
              setSidebarWidth(useStore.getState().sidebarWidth + d);
            }}
            onReset={() => setSidebarWidth(280)}
          />
        </>
      )}

      {sidebarOpen && !htmlImmersive && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 h-full w-[min(86vw,320px)] animate-enter">{panel}</div>
        </div>
      )}
      <ImportFolderDialog
        open={!!pendingImport?.length}
        files={pendingImport}
        onClose={() => setPendingImport(null)}
      />
    </>
  );
}
