import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  browserLibraryHint,
  createFile,
  getDefaultLibraryPath,
  getDocuments,
  getTree,
  importFromFolder,
  isBrowserMode,
  openLibrary,
  pickFolder,
  pickLibraryFolder,
  readFile,
  searchLibrary,
  supportsBrowserFolderPicker,
  writeFile,
} from "./lib/api";
import { renderMarkdownWithOutline } from "./lib/markdown";
import { type OutlineItem } from "./lib/outline";
import type { DocMeta, TreeNode } from "./lib/types";

type Mode = "preview" | "source";

const THEMES = [
  { id: "paper", label: "宣纸" },
  { id: "ink", label: "墨夜" },
  { id: "light", label: "素白" },
  { id: "forest", label: "竹林" },
  { id: "ocean", label: "沧海" },
  { id: "indigo", label: "黛青" },
  { id: "rose", label: "胭脂" },
  { id: "amber", label: "琥珀" },
  { id: "celadon", label: "青瓷" },
  { id: "slate", label: "玄铁" },
  { id: "sakura", label: "樱雨" },
  { id: "dusk", label: "暮紫" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
const THEME_STORAGE_KEY = "langhuan-theme";

function loadTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && THEMES.some((t) => t.id === raw)) return raw as ThemeId;
  } catch {
    /* ignore */
  }
  return "paper";
}

export default function App() {
  const [libraryPath, setLibraryPath] = useState("");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("preview");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [status, setStatus] = useState("正在打开琅嬛…");
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteName, setPasteName] = useState("未命名.md");
  const [pasteBody, setPasteBody] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  const paneRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const browserMode = isBrowserMode();
  const canPickFolder = !browserMode || supportsBrowserFolderPicker();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const selectedMeta = useMemo(
    () => docs.find((d) => d.path === selectedPath) ?? null,
    [docs, selectedPath],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [docs]);

  const refresh = useCallback(
    async (root: string, keepSelection?: string | null) => {
      const [t, d] = await Promise.all([getTree(root), getDocuments(root)]);
      setTree(t);
      setDocs(d);
      const prefer = keepSelection ?? selectedPath;
      if (prefer && d.some((x) => x.path === prefer)) {
        setSelectedPath(prefer);
      } else if (d.length > 0) {
        setSelectedPath(d[0].path);
      } else {
        setSelectedPath(null);
        setContent("");
        setDraft("");
      }
    },
    [selectedPath],
  );

  const bootstrap = useCallback(async () => {
    try {
      setBusy(true);
      const def = await getDefaultLibraryPath();
      const root = await openLibrary(def);
      setLibraryPath(root);
      await refresh(root, null);
      setStatus(
        browserMode
          ? `库：${browserLibraryHint(root)}`
          : `库：${root}`,
      );
    } catch (e) {
      setStatus(`打开失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [browserMode, refresh]);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!libraryPath || !selectedPath) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await readFile(libraryPath, selectedPath);
        if (cancelled) return;
        setContent(text);
        setDraft(text);
        setDirty(false);
        setMode("preview");
        setActiveHeading(null);
      } catch (e) {
        if (!cancelled) setStatus(`读取失败：${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryPath, selectedPath]);

  const filteredDocs = useMemo(() => {
    let list = docs;
    if (activeTag) {
      list = list.filter((d) => d.tags.includes(activeTag));
    }
    return list;
  }, [docs, activeTag]);

  const visiblePaths = useMemo(() => {
    if (!query.trim() && !activeTag) return null;
    return new Set(filteredDocs.map((d) => d.path));
  }, [filteredDocs, query, activeTag]);

  async function onSearch(q: string) {
    setQuery(q);
    if (!libraryPath) return;
    if (!q.trim()) {
      const d = await getDocuments(libraryPath);
      setDocs(d);
      return;
    }
    const hits = await searchLibrary(libraryPath, q);
    setDocs(hits);
  }

  async function save() {
    if (!libraryPath || !selectedPath) return;
    try {
      setBusy(true);
      await writeFile(libraryPath, selectedPath, draft);
      setContent(draft);
      setDirty(false);
      await refresh(libraryPath, selectedPath);
      setStatus(`已保存 ${selectedPath}`);
    } catch (e) {
      setStatus(`保存失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(kind: "md" | "html") {
    if (!libraryPath) return;
    const name = window.prompt(
      kind === "html" ? "新 HTML 文件名" : "新 Markdown 文件名",
      kind === "html" ? "新页面" : "新文档",
    );
    if (!name) return;
    try {
      setBusy(true);
      const path = await createFile(libraryPath, "", name, kind);
      await refresh(libraryPath, path);
      setSelectedPath(path);
      setStatus(`已新建 ${path}`);
    } catch (e) {
      setStatus(`新建失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onPasteSubmit() {
    if (!libraryPath || !pasteName.trim()) return;
    const kind =
      pasteName.toLowerCase().endsWith(".html") ||
      pasteName.toLowerCase().endsWith(".htm")
        ? "html"
        : "md";
    try {
      setBusy(true);
      const path = await createFile(
        libraryPath,
        "",
        pasteName,
        kind,
        pasteBody,
      );
      setShowPaste(false);
      setPasteBody("");
      await refresh(libraryPath, path);
      setSelectedPath(path);
      setStatus(`已粘贴入库 ${path}`);
    } catch (e) {
      setStatus(`粘贴失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!libraryPath) return;
    const src = await pickFolder();
    if (!src) return;
    try {
      setBusy(true);
      const n = await importFromFolder(libraryPath, src, "导入");
      await refresh(libraryPath, selectedPath);
      setStatus(`已导入 ${n} 个文档到「导入/」`);
    } catch (e) {
      setStatus(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onChangeLibrary() {
    const picked = await pickLibraryFolder();
    if (!picked) return;
    try {
      setBusy(true);
      const root = await openLibrary(picked);
      setLibraryPath(root);
      await refresh(root, null);
      setStatus(
        browserMode
          ? `库：${browserLibraryHint(root)}`
          : `库：${root}`,
      );
    } catch (e) {
      setStatus(`切换失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const isHtml =
    selectedMeta?.kind === "html" ||
    selectedPath?.toLowerCase().endsWith(".html") ||
    selectedPath?.toLowerCase().endsWith(".htm");

  // HTML 自带页内目录时不再解析大纲；中间「目录」栏仅给 Markdown 用
  const showToc = !isHtml;

  const previewBundle = useMemo(() => {
    if (!selectedPath) return { html: "", outline: [] as OutlineItem[] };
    if (isHtml) return { html: content, outline: [] as OutlineItem[] };
    return renderMarkdownWithOutline(content);
  }, [content, isHtml, selectedPath]);

  const outline = useMemo(() => {
    if (!selectedPath || isHtml) return [] as OutlineItem[];
    if (mode === "source") {
      return renderMarkdownWithOutline(draft).outline;
    }
    return previewBundle.outline;
  }, [selectedPath, mode, isHtml, draft, previewBundle.outline]);

  const previewHtml = previewBundle.html;

  function jumpToHeading(id: string) {
    setActiveHeading(id);
    if (mode === "source") {
      setMode("preview");
      // defer scroll until preview mounts
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToHeading(id));
      });
      return;
    }
    scrollToHeading(id);
  }

  function scrollToHeading(id: string) {
    if (isHtml) {
      const frame = iframeRef.current;
      try {
        const doc = frame?.contentDocument;
        const el = doc?.getElementById(id);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        /* sandbox / cross-origin */
      }
      return;
    }
    const pane = paneRef.current;
    const el = pane?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function toggleCollapse(path: string) {
    setCollapsed((c) => ({ ...c, [path]: !c[path] }));
  }

  function renderTree(node: TreeNode, depth = 0): ReactNode {
    if (!node.isDir && visiblePaths && !visiblePaths.has(node.path)) {
      return null;
    }
    if (node.isDir) {
      const kids = node.children ?? [];
      const renderedKids = kids
        .map((c) => renderTree(c, depth + (node.path ? 1 : 0)))
        .filter(Boolean);
      if (visiblePaths && node.path && renderedKids.length === 0) {
        return null;
      }
      const key = node.path || "__root__";
      const isCollapsed = !!collapsed[key];
      return (
        <div key={key} className="tree-dir">
          {node.path !== "" && (
            <button
              type="button"
              className="tree-dir-btn"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => toggleCollapse(key)}
            >
              <span className="chev">{isCollapsed ? "▸" : "▾"}</span>
              <span className="folder">📁</span>
              <span>{node.name}</span>
            </button>
          )}
          {!isCollapsed && <div>{renderedKids}</div>}
        </div>
      );
    }
    const active = selectedPath === node.path;
    return (
      <button
        type="button"
        key={node.path}
        className={`tree-file ${active ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          if (dirty && !window.confirm("有未保存修改，确定切换？")) return;
          setSelectedPath(node.path);
        }}
      >
        <span className="file-ico">
          {node.name.toLowerCase().endsWith(".html") ||
          node.name.toLowerCase().endsWith(".htm")
            ? "🌐"
            : "📄"}
        </span>
        <span className="file-name">{node.name}</span>
      </button>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">琅嬛</span>
          <span className="brand-sub">Langhuan</span>
          {browserMode ? (
            <span
              className="mode-badge"
              title="无需 Rust / Tauri，可直接在 Chrome 体验"
            >
              浏览器体验
            </span>
          ) : null}
        </div>
        <div className="topbar-right">
          <div className="theme-picker">
            <label htmlFor="theme-select">外观</label>
            <select
              id="theme-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeId)}
              title="整体色调"
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => onCreate("md")}>
              新建 MD
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCreate("html")}
            >
              新建 HTML
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowPaste(true)}
            >
              粘贴源码
            </button>
            <button
              type="button"
              disabled={busy || !canPickFolder}
              title={
                !canPickFolder
                  ? "当前浏览器不支持选择文件夹，请用 Chrome / Edge"
                  : undefined
              }
              onClick={() => void onImport()}
            >
              导入文件夹
            </button>
            <button
              type="button"
              disabled={busy || (browserMode && !canPickFolder)}
              title={
                browserMode && !canPickFolder
                  ? "当前浏览器不支持打开本地文件夹，演示库仍可用"
                  : browserMode
                    ? "用 Chrome 授权一个本地文件夹作为库"
                    : undefined
              }
              onClick={() => void onChangeLibrary()}
            >
              {browserMode ? "打开本地文件夹" : "切换库目录"}
            </button>
            {browserMode && libraryPath.startsWith("fs://") ? (
              <button
                type="button"
                disabled={busy}
                title="回到内置演示库"
                onClick={() => {
                  void (async () => {
                    try {
                      setBusy(true);
                      const root = await openLibrary(
                        await getDefaultLibraryPath(),
                      );
                      setLibraryPath(root);
                      await refresh(root, null);
                      setStatus(`库：${browserLibraryHint(root)}`);
                    } catch (e) {
                      setStatus(`切换失败：${String(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                演示库
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className={`main${showToc ? " with-toc" : " no-toc"}`}>
        <aside className="sidebar">
          <div className="search-box">
            <input
              value={query}
              placeholder="全文搜索标题 / 正文 / 标签…"
              onChange={(e) => void onSearch(e.target.value)}
            />
          </div>
          <div className="tags">
            <button
              type="button"
              className={`tag ${activeTag === null ? "on" : ""}`}
              onClick={() => setActiveTag(null)}
            >
              全部
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                className={`tag ${activeTag === t ? "on" : ""}`}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="tree">
            {tree ? renderTree(tree) : <p className="muted">加载目录…</p>}
          </div>
        </aside>

        {showToc && (
          <aside className="toc-panel" aria-label="文档目录">
            <div className="toc-head">目录</div>
            <div className="toc-list">
              {!selectedPath && (
                <p className="toc-empty">选择文档后显示标题大纲</p>
              )}
              {selectedPath && outline.length === 0 && (
                <p className="toc-empty">
                  {mode === "source"
                    ? "源码中暂无识别到标题（# 或 h1–h6）"
                    : "本文暂无标题大纲"}
                </p>
              )}
              {outline.map((item) => (
                <button
                  key={`${item.id}-${item.level}-${item.text}`}
                  type="button"
                  className={`toc-item l${item.level}${
                    activeHeading === item.id ? " active" : ""
                  }`}
                  title={item.text}
                  onClick={() => jumpToHeading(item.id)}
                >
                  {item.text}
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="workspace">
          <div className="docbar">
            <div className="doc-title">
              {selectedMeta?.title || selectedPath || "未选择文档"}
              {dirty ? <span className="dirty"> ●</span> : null}
            </div>
            <div className="doc-actions">
              <button
                type="button"
                className={mode === "preview" ? "on" : ""}
                onClick={() => setMode("preview")}
              >
                预览
              </button>
              <button
                type="button"
                className={mode === "source" ? "on" : ""}
                onClick={() => setMode("source")}
              >
                源码
              </button>
              <button
                type="button"
                disabled={!dirty || busy || !selectedPath}
                onClick={() => void save()}
              >
                保存
              </button>
            </div>
          </div>

          {selectedMeta && selectedMeta.tags.length > 0 && (
            <div className="doc-tags">
              {selectedMeta.tags.map((t) => (
                <span key={t} className="pill">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="pane" ref={paneRef}>
            {!selectedPath && (
              <p className="muted center">从左侧选择或新建一篇文档</p>
            )}
            {selectedPath && mode === "source" && (
              <textarea
                className="editor"
                value={draft}
                spellCheck={false}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(e.target.value !== content);
                }}
              />
            )}
            {selectedPath && mode === "preview" && isHtml && (
              <iframe
                ref={iframeRef}
                className="html-frame"
                title={selectedPath}
                sandbox="allow-same-origin"
                srcDoc={previewHtml}
              />
            )}
            {selectedPath && mode === "preview" && !isHtml && (
              <article
                className="md-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>
        </section>
      </div>

      <footer className="status">{status}</footer>

      {showPaste && (
        <div className="modal-backdrop" onClick={() => setShowPaste(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>粘贴源码入库</h2>
            <label>
              文件名（.md / .html）
              <input
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
              />
            </label>
            <label>
              源码
              <textarea
                value={pasteBody}
                onChange={(e) => setPasteBody(e.target.value)}
                placeholder="把 Markdown 或 HTML 源码粘贴到这里…"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowPaste(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPasteSubmit()}
              >
                入库
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
