"use client";

import * as React from "react";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Moon,
  Search,
  Star,
  Sun,
  Upload,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dropdown, DropdownItem } from "./ui/dropdown";
import { useStore, filteredDocuments } from "@/lib/store";
import { collectTagCounts } from "@/lib/tags";
import { titleOf } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ImportFolderDialog } from "./ImportFolderDialog";
import { ResizeGutter } from "./ui/ResizeGutter";

function Brand() {
  const openHome = useStore((s) => s.openHome);
  return (
    <button
      type="button"
      onClick={openHome}
      className="flex items-center gap-3 px-1 py-1 rounded-xl hover:bg-[var(--hover)] transition-colors text-left w-full"
      aria-label="回到首页"
    >
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white font-serif text-lg font-bold shadow-sm"
        style={{ transform: "rotate(-6deg)" }}
      >
        琅
      </span>
      <span className="min-w-0">
        <span className="block font-serif text-lg leading-none">琅嬛</span>
        <span className="block text-[10px] tracking-[0.22em] text-[var(--muted)] mt-1">LANGHUAN</span>
      </span>
    </button>
  );
}

type TreeNode = { name: string; path: string; docs: { id: string; name: string; type: string }[]; children: Map<string, TreeNode> };

function buildTree(docs: { id: string; path: string; type: string }[]) {
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
    node.docs.push({ id: d.id, name: parts[parts.length - 1], type: d.type });
  }
  return root;
}

function countDocs(node: TreeNode): number {
  let n = node.docs.length;
  for (const c of node.children.values()) n += countDocs(c);
  return n;
}

function FileTree({
  node,
  depth = 0,
}: {
  node: TreeNode;
  depth?: number;
}) {
  const activeId = useStore((s) => s.activeId);
  const openDoc = useStore((s) => s.openDoc);
  const isDirty = useStore((s) => s.isDirty);
  const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const files = [...node.docs].sort((a, b) => a.name.localeCompare(b.name, "zh"));

  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-[var(--border)] pl-2")}>
      {folders.map((f) => (
        <details key={f.path} open className="group/folder mb-0.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm hover:bg-[var(--hover)]">
            <FolderOpen className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
            <span className="truncate font-ui">{f.name}</span>
            <span className="ml-auto text-[10px] text-[var(--muted)] tabular-nums">{countDocs(f)}</span>
          </summary>
          <FileTree node={f} depth={depth + 1} />
        </details>
      ))}
      {files.map((f) => {
        const active = f.id === activeId;
        const dirty = isDirty(f.id);
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => openDoc(f.id)}
            className={cn(
              "relative flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-sm transition-colors",
              active ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]" : "hover:bg-[var(--hover)]"
            )}
          >
            {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--accent)]" />}
            {f.type === "html" ? (
              <Globe className="h-3.5 w-3.5 text-[var(--teal)] shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" />
            )}
            <span className="truncate font-ui">{titleOf(f.name)}</span>
            {dirty && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0" aria-label="未保存" />}
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
  const tagFilter = useStore((s) => s.tagFilter);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const openHome = useStore((s) => s.openHome);
  const activeId = useStore((s) => s.activeId);
  const createDoc = useStore((s) => s.createDoc);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const openDoc = useStore((s) => s.openDoc);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [tagsExpanded, setTagsExpanded] = React.useState(false);
  const [tagQuery, setTagQuery] = React.useState("");
  const [pendingImport, setPendingImport] = React.useState<{ path: string; content: string }[] | null>(null);

  const visible = filteredDocuments(documents, tagFilter);
  const tags = collectTagCounts(documents);
  const sortedTags = [...tags.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")
  );
  const tagQ = tagQuery.trim().toLowerCase();
  const filteredTags = tagQ
    ? sortedTags.filter(([name]) => name.toLowerCase().includes(tagQ))
    : sortedTags;
  const TAG_COLLAPSE_AT = 8;
  const tagsNeedCollapse = filteredTags.length > TAG_COLLAPSE_AT;
  const shownTags =
    tagsNeedCollapse && !tagsExpanded ? filteredTags.slice(0, TAG_COLLAPSE_AT) : filteredTags;
  const starred = documents.filter((d) => d.starred).sort((a, b) => b.updatedAt - a.updatedAt);
  const tree = buildTree(visible.map((d) => ({ id: d.id, path: d.path, type: d.type })));
  const bytes = useStore((s) => s.storageBytes)();

  const onPasteSource = () => {
    const text = window.prompt("粘贴 Markdown 或 HTML 源码：");
    if (text == null || !text.trim()) return;
    const isHtml = /^\s*</.test(text) || /<\/?[a-z][\s\S]*>/i.test(text);
    createDoc({ type: isHtml ? "html" : "md", content: text, open: true });
  };

  const handleImportList = async (list: FileList | File[], keepDir: boolean) => {
    const files: { path: string; content: string }[] = [];
    for (const file of Array.from(list)) {
      const path = keepDir ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name : file.name;
      if (!/\.(md|html|txt)$/i.test(path)) continue;
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
          if (entry.kind === "file" && /\.(md|html|txt)$/i.test(name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            collected.push({ path: prefix ? `${prefix}/${name}` : name, content: await file.text() });
          } else if (entry.kind === "directory") {
            await walk(entry as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name);
          }
        }
      };
      await walk(dir, "");
      if (collected.length) setPendingImport(collected);
    } catch {
      /* cancelled */
    }
  };

  const panel = (
    <aside className="flex h-full w-full flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] backdrop-blur-md">
      <div className="p-4 pb-2 space-y-3">
        <Brand />
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-10 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--muted)] hover:bg-[var(--hover)] transition-colors"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">搜索文档、标签、命令…</span>
          <kbd className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd>
        </button>
        <div className="flex gap-2">
          <Dropdown
            trigger={
              <Button variant="accent" className="flex-1" aria-label="新建">
                新建 <ChevronDown className="h-3.5 w-3.5 opacity-80" />
              </Button>
            }
          >
            <DropdownItem onClick={() => createDoc({ type: "md" })}>Markdown 笔记</DropdownItem>
            <DropdownItem onClick={() => createDoc({ type: "html" })}>HTML 页面</DropdownItem>
            <DropdownItem onClick={onPasteSource}>粘贴源码</DropdownItem>
          </Dropdown>
          <Dropdown
            trigger={
              <Button variant="secondary" className="flex-1" aria-label="导入">
                导入 <ChevronDown className="h-3.5 w-3.5 opacity-80" />
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
          accept=".md,.html,.txt,text/markdown,text/html"
          onChange={(e) => {
            if (e.target.files) void handleImportList(e.target.files, false);
            e.target.value = "";
          }}
        />
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openHome}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-ui transition-colors",
            !activeId ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]" : "hover:bg-[var(--hover)]"
          )}
        >
          <Home className="h-4 w-4" /> 首页
        </button>
      </div>

      <div className="px-3 pb-2 shrink-0">
        <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] px-2 mb-1.5 flex items-center justify-between gap-2">
          <span>标签</span>
          <span className="normal-case tracking-normal tabular-nums">{tags.size}</span>
        </div>
        {sortedTags.length > TAG_COLLAPSE_AT && (
          <div className="px-1 mb-1.5">
            <input
              value={tagQuery}
              onChange={(e) => {
                setTagQuery(e.target.value);
                setTagsExpanded(true);
              }}
              placeholder="筛选标签…"
              aria-label="筛选标签"
              className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-ui text-[var(--fg)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
            />
          </div>
        )}
        <div
          className={cn(
            "flex flex-wrap gap-1.5 content-start",
            tagsExpanded && tagsNeedCollapse && "max-h-36 overflow-y-auto scroll-thin pr-0.5"
          )}
        >
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs border transition-colors",
              !tagFilter
                ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                : "border-[var(--border)] hover:bg-[var(--hover)]"
            )}
          >
            全部 · {documents.length}
          </button>
          {shownTags.map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => setTagFilter(tagFilter === name ? null : name)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs border transition-colors",
                tagFilter === name
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  : "border-[var(--border)] hover:bg-[var(--hover)]"
              )}
            >
              {name} · {n}
            </button>
          ))}
        </div>
        {tagsNeedCollapse && (
          <button
            type="button"
            onClick={() => setTagsExpanded((v) => !v)}
            className="mt-1.5 w-full rounded-lg px-2 py-1 text-left text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
          >
            {tagsExpanded
              ? "收起标签"
              : `展开全部 ${filteredTags.length} 个标签`}
          </button>
        )}
      </div>

      {starred.length > 0 && (
        <div className="px-3 pb-2">
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] px-2 mb-1.5 flex items-center gap-1">
            <Star className="h-3 w-3 text-[var(--gold)]" /> 收藏
          </div>
          <div className="space-y-0.5">
            {starred.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openDoc(d.id)}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-[var(--hover)] text-left"
              >
                {d.type === "html" ? <Globe className="h-3.5 w-3.5 text-[var(--teal)]" /> : <FileText className="h-3.5 w-3.5" />}
                <span className="truncate">{titleOf(d.path)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 pb-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] px-2 mb-1.5">文件</div>
        <FileTree node={tree} />
      </div>

      <div className="border-t border-[var(--border)] p-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-[var(--muted)] leading-tight">
          <div>本地存储</div>
          <div className="tabular-nums">{(bytes / 1024).toFixed(1)} KB</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleTheme}
          aria-label={theme === "paper" ? "切换到墨色" : "切换到纸色"}
        >
          {theme === "paper" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          {theme === "paper" ? "墨" : "纸"}
        </Button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:flex h-full shrink-0" style={{ width: sidebarWidth }}>
        {panel}
      </div>
      <ResizeGutter
        className="hidden md:flex"
        axis="horizontal"
        label="调整侧栏宽度"
        value={sidebarWidth}
        min={220}
        max={420}
        onDelta={(d) => setSidebarWidth(sidebarWidth + d)}
      />
      {sidebarOpen && (
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
