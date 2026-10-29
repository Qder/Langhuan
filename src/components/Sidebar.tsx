"use client";

import * as React from "react";
import { BookOpenCheck,
  Archive,
  BookmarkPlus,
  CalendarDays,
  FolderSync,
  ChevronDown,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  Home,
  LayoutTemplate,
  Network,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  CheckSquare,
  Tag,
  Download,
  Columns2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Dropdown, DropdownItem } from "./ui/dropdown";
import { useStore, filteredDocuments } from "@/lib/store";
import { THEME_IDS, THEME_HINTS, THEME_LABELS, isDarkTheme, themeLabel } from "@/lib/theme";
import { collectTagCounts } from "@/lib/tags";
import { reviewBadgeCount } from "@/lib/quiz";
import { dirname, titleOf, cn, relativeTime, basename } from "@/lib/utils";
import { buildTree, isPathUnderFolder, type FolderTreeNode } from "@/lib/folders";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { openCreateDocDialog } from "@/lib/createDocDialogBus";
import { MoveFolderDialog, RenameFolderDialog } from "./FolderOpsDialogs";
import { PasteSourceDialog } from "./PasteSourceDialog";
import { AddTagsDialog, MoveDocsDialog } from "./BatchOpsDialogs";
import { formatBytes } from "@/lib/storage/usage";
import { ImportFolderDialog, type PendingImportAsset, type PendingImportDoc } from "./ImportFolderDialog";
import { importClipboardAs } from "@/lib/clipboardImport";
import {
  IMPORTABLE_ACCEPT,
  isImportableImagePath,
  isImportableLibraryPath,
  mimeForImportableImage,
} from "@/lib/importable";
import { formatImportStatus } from "@/lib/importPaths";
import { ResizeGutter } from "./ui/ResizeGutter";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";
import { useMediaQuery } from "@/lib/useMediaQuery";

type TreeNode = FolderTreeNode;

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
  onFolderContextMenu,
  onFileContextMenu,
}: {
  node: TreeNode;
  depth?: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  compact: boolean;
  activeId: string | null;
  rowH: string;
  onFolderContextMenu: (folderPath: string, e: React.MouseEvent) => void;
  onFileContextMenu: (docId: string, e: React.MouseEvent) => void;
}) {
  const openDoc = useStore((s) => s.requestOpenDoc);
  const requestTreeReveal = useStore((s) => s.requestTreeReveal);
  const isDirty = useStore((s) => s.isDirty);
  const batchMode = useStore((s) => s.batchMode);
  const treeSelection = useStore((s) => s.treeSelection);
  const toggleTreeSelected = useStore((s) => s.toggleTreeSelected);
  const moveDocsToFolder = useStore((s) => s.moveDocsToFolder);
  const importFiles = useStore((s) => s.importFiles);
  const openInSplit = useStore((s) => s.openInSplit);
  const setStatus = useStore((s) => s.setStatus);
  const folders = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh")
  );
  const files = [...node.docs].sort((a, b) => a.name.localeCompare(b.name, "zh"));

  void compact;
  const deep = depth > 3;

  const moveFolder = useStore((s) => s.moveFolder);

  const onDropToFolder = async (folderPath: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const folderSrc = e.dataTransfer.getData("application/x-langhuan-folder");
    if (folderSrc) {
      if (folderSrc === folderPath) return;
      moveFolder(folderSrc, folderPath);
      return;
    }
    const docId = e.dataTransfer.getData("application/x-langhuan-doc");
    if (docId) {
      const selected = useStore.getState().treeSelection;
      const ids = selected.includes(docId) && selected.length > 1 ? selected : [docId];
      moveDocsToFolder(ids, folderPath);
      return;
    }
    if (e.dataTransfer.files?.length) {
      const collected: { path: string; content: string }[] = [];
      const collectedAssets: PendingImportAsset[] = [];
      for (const file of Array.from(e.dataTransfer.files)) {
        const rel =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        const base = folderPath ? `${folderPath}/${rel}` : rel;
        if (isImportableLibraryPath(rel)) {
          collected.push({ path: base, content: await file.text() });
        } else if (isImportableImagePath(rel)) {
          collectedAssets.push({
            path: base,
            blob: file,
            mime: mimeForImportableImage(rel, file.type),
          });
        }
      }
      if (collected.length || collectedAssets.length) {
        const n = importFiles(collected, { quiet: true });
        const m = await useStore.getState().importAssets(collectedAssets, {
          quiet: true,
        });
        const where = folderPath || "根目录";
        const msg = formatImportStatus(n, m);
        setStatus(msg === "没有可导入的文件" ? msg : `${msg}到 ${where}`);
      }
    }
  };

  return (
    <div
      className={cn(depth > 0 && "border-l border-[var(--border)]")}
      style={depth > 0 ? { marginLeft: 12, paddingLeft: 8 } : undefined}
      onDragOver={(e) => {
        if (depth === 0) e.preventDefault();
      }}
      onDrop={depth === 0 ? (e) => void onDropToFolder("", e) : undefined}
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
              data-tree-folder={f.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-langhuan-folder", f.path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onToggle(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFolderContextMenu(f.path, e);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => void onDropToFolder(f.path, e)}
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
                onFolderContextMenu={onFolderContextMenu}
                onFileContextMenu={onFileContextMenu}
              />
            )}
          </div>
        );
      })}
      {files.map((f) => {
        const active = f.id === activeId;
        const dirty = isDirty(f.id);
        const selected = treeSelection.includes(f.id);
        return (
          <div
            key={f.id}
            className={cn(
              "relative flex w-full items-center gap-1 rounded-xl px-1 text-left text-sm transition-colors group",
              rowH,
              active
                ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                : selected
                  ? "bg-[color-mix(in_srgb,var(--teal)_10%,transparent)]"
                  : "hover:bg-[var(--hover)]"
            )}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-langhuan-doc", f.id);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            {active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--accent)]" />
            )}
            {(batchMode || selected) && (
              <input
                type="checkbox"
                className="ml-1 shrink-0 accent-[var(--accent)]"
                checked={selected}
                onChange={() => toggleTreeSelected(f.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`选择 ${f.name}`}
              />
            )}
            <button
              type="button"
              data-tree-id={f.id}
              className="flex min-w-0 flex-1 items-center gap-1.5 px-1 h-full"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || batchMode) {
                  e.preventDefault();
                  toggleTreeSelected(f.id);
                  return;
                }
                openDoc(f.id);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                requestTreeReveal(f.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFileContextMenu(f.id, e);
              }}
            >
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
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--hover)]"
              title="分屏打开"
              aria-label="分屏打开"
              onClick={(e) => {
                e.stopPropagation();
                openInSplit(f.id);
              }}
            >
              <Columns2 className="h-3 w-3 text-[var(--muted)]" />
            </button>
          </div>
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
  const statusFilter = useStore((s) => s.statusFilter);
  const setStatusFilter = useStore((s) => s.setStatusFilter);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const setTemplateDialogOpen = useStore((s) => s.setTemplateDialogOpen);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);
  const setQuizReviewOpen = useStore((s) => s.setQuizReviewOpen);
  const quizDocs = useStore((s) => s.quizDocs);
  const reviewCount = React.useMemo(() => {
    const b = reviewBadgeCount(quizDocs, new Set(documents.map((d) => d.id)));
    return b.dontKnow + b.unseen;
  }, [quizDocs, documents]);
  const setClipUrlDialogOpen = useStore((s) => s.setClipUrlDialogOpen);
  const openHome = useStore((s) => s.requestOpenHome);
  const activeId = useStore((s) => s.activeId);
  const createDoc = useStore((s) => s.createDoc);
  const emptyFolders = useStore((s) => s.emptyFolders);
  const setStatus = useStore((s) => s.setStatus);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const sidebarPanel = useStore((s) => s.sidebarPanel);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const treeRevealRequest = useStore((s) => s.treeRevealRequest);
  const trash = useStore((s) => s.trash);
  const restoreFromTrash = useStore((s) => s.restoreFromTrash);
  const purgeTrashItem = useStore((s) => s.purgeTrashItem);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const storageUsage = useStore((s) => s.storageUsage);
  const refreshStorageUsage = useStore((s) => s.refreshStorageUsage);
  const setBackupDialogOpen = useStore((s) => s.setBackupDialogOpen);
  const setFsSyncDialogOpen = useStore((s) => s.setFsSyncDialogOpen);
  const fsBoundName = useStore((s) => s.fsBoundName);
  const batchMode = useStore((s) => s.batchMode);
  const setBatchMode = useStore((s) => s.setBatchMode);
  const treeSelection = useStore((s) => s.treeSelection);
  const clearTreeSelection = useStore((s) => s.clearTreeSelection);
  const setTreeSelection = useStore((s) => s.setTreeSelection);
  const batchDelete = useStore((s) => s.batchDelete);
  const moveDocsToFolder = useStore((s) => s.moveDocsToFolder);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const htmlSidebarPeek = useStore((s) => s.htmlSidebarPeek);
  const setHtmlSidebarPeek = useStore((s) => s.setHtmlSidebarPeek);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [tagQuery, setTagQuery] = React.useState("");
  const [pendingImport, setPendingImport] = React.useState<{
    docs: PendingImportDoc[];
    assets: PendingImportAsset[];
  } | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [folderMenu, setFolderMenu] = React.useState<{
    x: number;
    y: number;
    folderPath: string;
  } | null>(null);
  const [fileMenu, setFileMenu] = React.useState<{
    x: number;
    y: number;
    docId: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<
    | { kind: "doc"; id: string; title: string }
    | { kind: "folder"; path: string; docCount: number }
    | { kind: "batch"; ids: string[]; count: number }
    | { kind: "empty-trash"; count: number }
    | { kind: "purge"; id: string; title: string }
    | null
  >(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [moveDocsOpen, setMoveDocsOpen] = React.useState(false);
  const [addTagsOpen, setAddTagsOpen] = React.useState(false);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const openInSplit = useStore((s) => s.openInSplit);

  const compact = useMediaQuery("(max-height: 699px)");
  const rowH = compact ? "h-7" : "h-8"; // 28 / 32

  const visible = filteredDocuments(documents, tagFilters, statusFilter);
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
    })),
    emptyFolders
  );
  const bytes = storageUsage?.usedBytes ?? useStore.getState().storageBytes();
  const activeDoc = documents.find((d) => d.id === activeId) || null;
  const statusHint =
    statusFilter === "todo"
      ? "待整理"
      : statusFilter === "draft"
        ? "草稿"
        : statusFilter === "evergreen"
          ? "常青"
          : statusFilter === "archived"
            ? "归档"
            : "";
  const pathHint = activeDoc
    ? dirname(activeDoc.path) || "根目录"
    : [tagFilters.length ? `标签 · ${tagFilters.map((t) => `#${t}`).join(" ")}` : "", statusHint ? `状态 · ${statusHint}` : ""]
        .filter(Boolean)
        .join(" · ") || "全部文档";

  React.useEffect(() => {
    void refreshStorageUsage();
  }, [documents, trash, refreshStorageUsage]);

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

  // Reveal in tree only on explicit request (tab/row dblclick) — never on activeId/expanded.
  React.useEffect(() => {
    if (!treeRevealRequest || sidebarPanel !== "docs") return;
    const doc = documents.find((d) => d.id === treeRevealRequest.docId);
    if (!doc) return;
    const anc = ancestorsOf(doc.path);
    if (anc.length) {
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
    }
    const docId = treeRevealRequest.docId;
    const t = window.setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector(`[data-tree-id="${docId}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [treeRevealRequest, sidebarPanel, documents]);

  const onToggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openFolderContextMenu = React.useCallback(
    (folderPath: string, e: React.MouseEvent | { clientX: number; clientY: number }) => {
      setFileMenu(null);
      setFolderMenu({ x: e.clientX, y: e.clientY, folderPath });
    },
    []
  );

  const openFileContextMenu = React.useCallback(
    (docId: string, e: React.MouseEvent) => {
      setFolderMenu(null);
      setFileMenu({ x: e.clientX, y: e.clientY, docId });
    },
    []
  );

  const createInFolder = React.useCallback(
    (folderPath: string, type: "md" | "html") => {
      openCreateDocDialog({ type, defaultParent: folderPath });
    },
    []
  );

  const [createFolderOpen, setCreateFolderOpen] = React.useState(false);
  const [createFolderParent, setCreateFolderParent] = React.useState("");
  const [renameFolderPath, setRenameFolderPath] = React.useState<string | null>(null);
  const [moveFolderPath, setMoveFolderPath] = React.useState<string | null>(null);

  const onCreateFolder = React.useCallback((parentOverride?: string) => {
    // Topbar / Plus: library root. Context menu: that folder (editable in dialog).
    setCreateFolderParent(parentOverride !== undefined ? parentOverride : "");
    setCreateFolderOpen(true);
  }, [setCreateFolderParent, setCreateFolderOpen]);

  const onFolderCreated = React.useCallback(
    (full: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(full);
        const parts = full.split("/");
        for (let i = 1; i < parts.length; i++) {
          next.add(parts.slice(0, i).join("/"));
        }
        return next;
      });
      setSidebarPanel("docs");
    },
    [setSidebarPanel]
  );

  const folderMenuItems: ContextMenuItem[] = React.useMemo(() => {
    if (!folderMenu) return [];
    const folderPath = folderMenu.folderPath;
    const items: ContextMenuItem[] = [
      {
        id: "new-folder",
        label: "新建文件夹",
        onSelect: () => onCreateFolder(folderPath),
      },
      {
        id: "new-md",
        label: "新建 Markdown 笔记",
        onSelect: () => createInFolder(folderPath, "md"),
      },
      {
        id: "new-html",
        label: "新建 HTML 页面",
        onSelect: () => createInFolder(folderPath, "html"),
      },
      {
        id: "new-template",
        label: "从模板新建",
        onSelect: () => setTemplateDialogOpen(true),
      },
    ];
    // 库根不可删；仅真实文件夹显示「重命名 / 移动 / 删除」
    if (folderPath) {
      items.push({
        id: "rename-folder",
        label: "重命名",
        onSelect: () => setRenameFolderPath(folderPath),
      });
      items.push({
        id: "move-folder",
        label: "移动到…",
        onSelect: () => setMoveFolderPath(folderPath),
      });
      const docCount = documents.filter((d) =>
        isPathUnderFolder(d.path, folderPath)
      ).length;
      items.push({
        id: "delete-folder",
        label: "删除",
        danger: true,
        onSelect: () =>
          setDeleteConfirm({ kind: "folder", path: folderPath, docCount }),
      });
    }
    return items;
  }, [
    folderMenu,
    documents,
    createInFolder,
    onCreateFolder,
    setTemplateDialogOpen,
    setRenameFolderPath,
    setMoveFolderPath,
  ]);

  const fileMenuItems: ContextMenuItem[] = React.useMemo(() => {
    if (!fileMenu) return [];
    const docId = fileMenu.docId;
    const doc = documents.find((d) => d.id === docId);
    const title = doc ? titleOf(doc.path) : "文档";
    return [
      {
        id: "open-split",
        label: "分屏打开",
        onSelect: () => openInSplit(docId),
      },
      {
        id: "delete",
        label: "删除",
        danger: true,
        onSelect: () => setDeleteConfirm({ kind: "doc", id: docId, title }),
      },
    ];
  }, [fileMenu, documents, openInSplit]);

  const onPasteSource = () => setPasteOpen(true);

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
    const files: PendingImportDoc[] = [];
    const assets: PendingImportAsset[] = [];
    for (const file of Array.from(list)) {
      const path = keepDir
        ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        : file.name;
      if (isImportableLibraryPath(path)) {
        files.push({ path, content: await readFileAsText(file) });
      } else if (keepDir && isImportableImagePath(path)) {
        // Folder / multi-file batches keep relative image paths; single-file pick stays text-only.
        assets.push({
          path,
          blob: file,
          mime: mimeForImportableImage(path, file.type),
        });
      }
    }
    if (files.length || assets.length) setPendingImport({ docs: files, assets });
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
      const collected: PendingImportDoc[] = [];
      const collectedAssets: PendingImportAsset[] = [];
      const walk = async (handle: FileSystemDirectoryHandle, prefix: string) => {
        for await (const [name, entry] of handle.entries()) {
          const rel = prefix ? `${prefix}/${name}` : name;
          if (entry.kind === "file" && isImportableLibraryPath(name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            collected.push({
              path: rel,
              content: await file.text(),
            });
          } else if (entry.kind === "file" && isImportableImagePath(name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            collectedAssets.push({
              path: rel,
              blob: file,
              mime: mimeForImportableImage(name, file.type),
            });
          } else if (entry.kind === "directory") {
            await walk(entry as FileSystemDirectoryHandle, rel);
          }
        }
      };
      await walk(dir, "");
      if (collected.length || collectedAssets.length) {
        setPendingImport({ docs: collected, assets: collectedAssets });
      }
    } catch {
      /* cancelled */
    }
  };

  const toggleTag = (name: string) => {
    // Stay on tags panel so multi-select is easy; docs panel still shows chips.
    toggleTagFilter(name);
  };

  // Keep 文档|标签|收藏 only (grid-cols-3). Trash lives in the bottom bar / ⌘K.
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
          <Dropdown
            align="right"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className={cn("shrink-0", compact ? "h-7 w-7" : "h-8 w-8")}
                aria-label={`主题：${themeLabel(theme)}`}
                title={`主题：${themeLabel(theme)}`}
              >
                <Palette className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {THEME_IDS.map((id) => (
              <DropdownItem
                key={id}
                onClick={() => {
                  setTheme(id);
                  setStatus(`已切换到${THEME_LABELS[id]}`);
                }}
              >
                <span
                  className={cn(
                    "inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)]",
                    isDarkTheme(id) ? "bg-[#1a1d26]" : "bg-[#faf8f3]"
                  )}
                  style={
                    id === "bamboo"
                      ? { background: "#2f6b4f" }
                      : id === "xuan"
                        ? { background: "#3a5080" }
                        : id === "songyan"
                          ? { background: "#a8b0bc" }
                          : id === "jiang"
                            ? { background: "#8b3a4a" }
                            : { background: "#2dd4bf" }
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{THEME_LABELS[id]}</span>
                  <span className="truncate text-[10px] text-[var(--muted)]">
                    {THEME_HINTS[id]}
                  </span>
                </span>
                {theme === id && (
                  <span className="text-[10px] text-[var(--accent)]">当前</span>
                )}
              </DropdownItem>
            ))}
          </Dropdown>
          {compact && (
            <span className="shrink-0 text-[10px] text-[var(--muted)] tabular-nums pr-1">
              {formatBytes(bytes)}
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
            <DropdownItem onClick={() => openCreateDocDialog({ type: "md" })}>Markdown 笔记</DropdownItem>
            <DropdownItem onClick={() => openCreateDocDialog({ type: "html" })}>HTML 页面</DropdownItem>
            <DropdownItem onClick={() => onCreateFolder()}>
              <FolderPlus className="h-3.5 w-3.5" /> 新建文件夹
            </DropdownItem>
            <DropdownItem onClick={() => openDailyNote()}>
              <CalendarDays className="h-3.5 w-3.5" /> 今日笔记
            </DropdownItem>
            <DropdownItem onClick={() => setTemplateDialogOpen(true)}>
              <LayoutTemplate className="h-3.5 w-3.5" /> 从模板新建
            </DropdownItem>
            <DropdownItem onClick={onPasteSource}>粘贴源码</DropdownItem>
            <DropdownItem onClick={() => void onClipperMd()}>从剪贴板导入网页</DropdownItem>
            <DropdownItem onClick={() => void onClipperHtml()}>保存 HTML 快照</DropdownItem>
            <DropdownItem onClick={() => setClipUrlDialogOpen(true)}>
              <BookmarkPlus className="h-3.5 w-3.5" /> 网页剪藏 URL
            </DropdownItem>
            <DropdownItem onClick={() => setGraphDialogOpen(true)}>
              <Network className="h-3.5 w-3.5" /> 知识图谱
            </DropdownItem>
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
              {reviewCount > 0 && (
                <button
                  type="button"
                  onClick={() => setQuizReviewOpen(true)}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-left text-xs text-[var(--fg)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-elevated))]"
                >
                  <BookOpenCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">待复习</span>
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger,#e11d48)] px-1 text-[10px] font-semibold text-white">
                    {reviewCount > 99 ? "99+" : reviewCount}
                  </span>
                </button>
              )}
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
              <div className="mb-1.5 flex flex-wrap gap-1 px-1">
                {(
                  [
                    [null, "全部"],
                    ["todo", "待整理"],
                    ["draft", "草稿"],
                    ["evergreen", "常青"],
                    ["archived", "归档"],
                  ] as const
                ).map(([id, label]) => {
                  const on = statusFilter === id || (id === null && !statusFilter);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStatusFilter(id)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] border transition-colors",
                        on
                          ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                          : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="mb-1.5 flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => setBatchMode(!batchMode)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    batchMode
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
                  )}
                >
                  <CheckSquare className="h-3 w-3" /> 批量
                </button>
                {treeSelection.length > 0 && (
                  <span className="text-[10px] text-[var(--muted)] tabular-nums">
                    已选 {treeSelection.length}
                  </span>
                )}
                {treeSelection.length > 0 && (
                  <button
                    type="button"
                    className="text-[10px] text-[var(--muted)] underline ml-auto"
                    onClick={() => clearTreeSelection()}
                  >
                    清除
                  </button>
                )}
                {batchMode && treeSelection.length === 0 && (
                  <button
                    type="button"
                    className="text-[10px] text-[var(--muted)] underline ml-auto"
                    onClick={() => setTreeSelection(visible.map((d) => d.id))}
                  >
                    全选可见
                  </button>
                )}
              </div>
              {treeSelection.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1 px-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] hover:bg-[var(--hover)]"
                    onClick={() => setMoveDocsOpen(true)}
                  >
                    <FolderOpen className="h-3 w-3" /> 移动
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] hover:bg-[var(--hover)]"
                    onClick={() => setAddTagsOpen(true)}
                  >
                    <Tag className="h-3 w-3" /> 打标签
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] hover:bg-[var(--hover)]"
                    onClick={() => setExportDialogOpen(true)}
                  >
                    <Download className="h-3 w-3" /> 导出
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--accent)]/40 text-[var(--accent)] px-2 py-1 text-[10px] hover:bg-[var(--hover)]"
                    onClick={() =>
                      setDeleteConfirm({
                        kind: "batch",
                        ids: [...treeSelection],
                        count: treeSelection.length,
                      })
                    }
                  >
                    <Trash2 className="h-3 w-3" /> 删除
                  </button>
                </div>
              )}
              <div
                className="min-h-[120px]"
                onContextMenu={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest("[data-tree-folder]") || t.closest("[data-tree-id]")) return;
                  e.preventDefault();
                  openFolderContextMenu("", e);
                }}
              >
                <FileTree
                  node={tree}
                  expanded={expanded}
                  onToggle={onToggleFolder}
                  compact={compact}
                  activeId={activeId}
                  rowH={rowH}
                  onFolderContextMenu={openFolderContextMenu}
                  onFileContextMenu={openFileContextMenu}
                />
              </div>
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

          {sidebarPanel === "trash" && (
            <div className="space-y-2 pb-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-[11px] font-medium text-[var(--fg)]">
                  回收站
                  <span className="ml-1 font-normal text-[var(--muted)]">· 保留 30 天</span>
                </span>
                <button
                  type="button"
                  disabled={!trash.length}
                  onClick={() => {
                    if (!trash.length) return;
                    setDeleteConfirm({ kind: "empty-trash", count: trash.length });
                  }}
                  className="text-[11px] text-[var(--accent)] disabled:opacity-40 hover:underline"
                >
                  清空
                </button>
              </div>
              {trash.length === 0 ? (
                <div className="text-xs text-[var(--muted)] px-2 py-6 text-center">回收站是空的</div>
              ) : (
                trash.map((t) => (
                  <div
                    key={t.doc.id}
                    className="rounded-xl border border-[var(--border)] px-2 py-1.5 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Trash2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                      <span className="truncate text-sm min-w-0 flex-1">{titleOf(t.doc.path)}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)] truncate pl-5">
                      {basename(t.doc.path)} · {relativeTime(t.deletedAt)}
                    </div>
                    <div className="flex gap-1 pl-5">
                      <button
                        type="button"
                        onClick={() => restoreFromTrash(t.doc.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] hover:bg-[var(--hover)]"
                      >
                        <RotateCcw className="h-3 w-3" /> 恢复
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirm({
                            kind: "purge",
                            id: t.doc.id,
                            title: titleOf(t.doc.path),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--hover)]"
                      >
                        彻底删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* —— Bottom fixed 40px —— */}
      {!compact && (
        <div className="h-10 shrink-0 border-t border-[var(--border)] px-2 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => setBackupDialogOpen(true)}
            className="min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--hover)]"
            title="备份与恢复"
          >
            <div className="text-[10px] text-[var(--muted)] leading-tight truncate">
              {storageUsage?.level === "crit"
                ? "存储告急"
                : storageUsage?.level === "warn"
                  ? "存储偏高"
                  : "IndexedDB"}
            </div>
            <div
              className={cn(
                "tabular-nums text-[11px] leading-tight",
                storageUsage?.level === "crit" && "text-[var(--accent)]",
                storageUsage?.level === "warn" && "text-[var(--gold)]"
              )}
            >
              {formatBytes(bytes)}
              {storageUsage?.quotaBytes
                ? ` / ${formatBytes(storageUsage.quotaBytes)}`
                : ""}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFsSyncDialogOpen(true)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--hover)]"
            aria-label="本地文件夹同步"
            title={fsBoundName ? `本地同步：${fsBoundName}` : "本地文件夹同步"}
          >
            <FolderSync className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setBackupDialogOpen(true)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--hover)]"
            aria-label="备份与恢复"
            title="备份与恢复"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              setSidebarPanel(sidebarPanel === "trash" ? "docs" : "trash")
            }
            className={cn(
              "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--hover)]",
              sidebarPanel === "trash" && "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
            )}
            aria-label="回收站"
            title="回收站"
            aria-pressed={sidebarPanel === "trash"}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {trash.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-[var(--accent)] px-1 text-[9px] leading-[14px] text-white tabular-nums text-center">
                {trash.length > 99 ? "99+" : trash.length}
              </span>
            )}
          </button>
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
        <DropdownItem onClick={() => openCreateDocDialog({ type: "md" })}>Markdown 笔记</DropdownItem>
        <DropdownItem onClick={() => openCreateDocDialog({ type: "html" })}>HTML 页面</DropdownItem>
        <DropdownItem onClick={() => onCreateFolder()}>新建文件夹</DropdownItem>
        <DropdownItem onClick={() => openDailyNote()}>今日笔记</DropdownItem>
        <DropdownItem onClick={() => setTemplateDialogOpen(true)}>从模板新建</DropdownItem>
        <DropdownItem onClick={onPasteSource}>粘贴源码</DropdownItem>
        <DropdownItem onClick={() => setGraphDialogOpen(true)}>知识图谱</DropdownItem>
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
        open={!!(pendingImport && (pendingImport.docs.length || pendingImport.assets.length))}
        files={pendingImport?.docs ?? null}
        assets={pendingImport?.assets ?? null}
        onClose={() => setPendingImport(null)}
      />
      {folderMenu && (
        <PreviewContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems}
          onClose={() => setFolderMenu(null)}
          ariaLabel={folderMenu.folderPath ? `文件夹「${folderMenu.folderPath}」菜单` : "文档树菜单"}
        />
      )}
      {fileMenu && (
        <PreviewContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          items={fileMenuItems}
          onClose={() => setFileMenu(null)}
          ariaLabel="文件菜单"
        />
      )}
      {createFolderOpen ? (
        <CreateFolderDialog
          key={`${createFolderParent}::${createFolderOpen}`}
          open={createFolderOpen}
          onClose={() => setCreateFolderOpen(false)}
          defaultParent={createFolderParent}
          onCreated={onFolderCreated}
        />
      ) : null}
      {renameFolderPath ? (
        <RenameFolderDialog
          key={`rename:${renameFolderPath}`}
          open
          folderPath={renameFolderPath}
          onClose={() => setRenameFolderPath(null)}
          onDone={onFolderCreated}
        />
      ) : null}
      {moveFolderPath ? (
        <MoveFolderDialog
          key={`move:${moveFolderPath}`}
          open
          folderPath={moveFolderPath}
          onClose={() => setMoveFolderPath(null)}
          onDone={onFolderCreated}
        />
      ) : null}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        labelledBy="tree-delete-title"
      >
        <div className="p-5 space-y-3">
          <h2 id="tree-delete-title" className="font-serif text-lg font-semibold">
            {deleteConfirm?.kind === "folder" && deleteConfirm.docCount === 0
              ? "删除空文件夹？"
              : deleteConfirm?.kind === "empty-trash" || deleteConfirm?.kind === "purge"
                ? "彻底删除？"
                : "移入回收站？"}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {deleteConfirm?.kind === "folder"
              ? deleteConfirm.docCount > 0
                ? `将文件夹「${deleteConfirm.path}」及其下的 ${deleteConfirm.docCount} 篇文档移入回收站，可在 30 天内恢复。`
                : `删除空文件夹「${deleteConfirm.path}」。`
              : deleteConfirm?.kind === "batch"
                ? `将已选 ${deleteConfirm.count} 篇移入回收站，可在 30 天内恢复。`
                : deleteConfirm?.kind === "empty-trash"
                  ? `彻底删除回收站中的 ${deleteConfirm.count} 篇？此操作不可恢复。`
                  : deleteConfirm?.kind === "purge"
                    ? `彻底删除「${deleteConfirm.title}」？此操作不可恢复。`
                    : `将「${deleteConfirm?.kind === "doc" ? deleteConfirm.title : ""}」移入回收站，可在 30 天内恢复。`}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              取消
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.kind === "doc") {
                  deleteDoc(deleteConfirm.id);
                } else if (deleteConfirm.kind === "folder") {
                  deleteFolder(deleteConfirm.path);
                } else if (deleteConfirm.kind === "batch") {
                  batchDelete(deleteConfirm.ids);
                } else if (deleteConfirm.kind === "empty-trash") {
                  emptyTrash();
                } else if (deleteConfirm.kind === "purge") {
                  purgeTrashItem(deleteConfirm.id);
                }
                setDeleteConfirm(null);
              }}
            >
              {deleteConfirm?.kind === "empty-trash" || deleteConfirm?.kind === "purge"
                ? "彻底删除"
                : "删除"}
            </Button>
          </div>
        </div>
      </Dialog>
      <PasteSourceDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        openAfterCreate
      />
      <MoveDocsDialog
        open={moveDocsOpen}
        docIds={treeSelection}
        onClose={() => setMoveDocsOpen(false)}
      />
      <AddTagsDialog
        open={addTagsOpen}
        docIds={treeSelection}
        onClose={() => setAddTagsOpen(false)}
      />
    </>
  );
}
