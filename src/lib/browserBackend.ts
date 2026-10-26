import type { DocMeta, TreeNode } from "./types";
import {
  isDocPath,
  kindOf,
  parseMeta,
  sanitizeFilename,
} from "./meta";

export const DEMO_LIBRARY_PATH = "琅嬛（浏览器演示）";
const STORAGE_KEY = "langhuan.browser.demo.v1";

type BackendMode = "demo" | "fs";

let mode: BackendMode = "demo";
let demoFiles = new Map<string, string>();
let fsRoot: FileSystemDirectoryHandle | null = null;
let pendingLibraryHandle: FileSystemDirectoryHandle | null = null;
let pendingImportHandle: FileSystemDirectoryHandle | null = null;

function sampleFiles(): Map<string, string> {
  const m = new Map<string, string>();
  m.set(
    "欢迎.md",
    `---
title: 欢迎来到琅嬛
tags: [入门, 示例]
---

# 欢迎来到琅嬛

琅嬛（láng huán）是个人本地知识库。当前为**浏览器体验**模式：内容保存在本机浏览器中，打开即可预览 Markdown 与 HTML。

## 已支持

- Markdown 预览与源码编辑
- HTML 沙箱预览
- 全文搜索、目录树、标签
- 新建 / 粘贴源码
- （可选）打开本地文件夹读写真实文件

## 标签写法

Markdown 使用 YAML frontmatter：

\`\`\`yaml
---
title: 标题
tags: [标签1, 标签2]
---
\`\`\`

HTML 可在文件头部写：

\`\`\`html
<!-- tags: 标签1, 标签2 -->
\`\`\`
`,
  );
  m.set(
    "示例页面.html",
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>琅嬛 HTML 示例</title>
  <!-- tags: 示例, html -->
  <style>
    body { font-family: "Songti SC", "Noto Serif SC", serif; padding: 2rem; background: #f7f3ea; color: #2c2416; }
    h1 { border-bottom: 2px solid #c4a574; padding-bottom: .4rem; }
    .card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 4px 16px rgba(0,0,0,.06); }
  </style>
</head>
<body>
  <div class="card">
    <h1>琅嬛 · HTML 沙箱预览</h1>
    <p>这份 HTML 会以沙箱 iframe 打开，脚本能力受限。</p>
  </div>
</body>
</html>
`,
  );
  m.set(
    "笔记/空白笔记.md",
    `---
title: 空白笔记
tags: [笔记]
---

# 空白笔记

在这里写下你的第一段文字。
`,
  );
  return m;
}

function loadDemoFromStorage(): Map<string, string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, string>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && isDocPath(k)) m.set(k.replace(/\\/g, "/"), v);
    }
    return m.size > 0 ? m : null;
  } catch {
    return null;
  }
}

function persistDemo() {
  if (mode !== "demo") return;
  const obj: Record<string, string> = {};
  demoFiles.forEach((v, k) => {
    obj[k] = v;
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota etc. */
  }
}

function ensureDemo() {
  if (demoFiles.size > 0) return;
  demoFiles = loadDemoFromStorage() ?? sampleFiles();
  persistDemo();
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function buildTreeFromPaths(
  paths: string[],
  rootName: string,
): TreeNode {
  type Mutable = {
    name: string;
    path: string;
    isDir: boolean;
    childrenMap: Map<string, Mutable>;
  };

  const root: Mutable = {
    name: rootName,
    path: "",
    isDir: true,
    childrenMap: new Map(),
  };

  for (const rel of paths.sort((a, b) => a.localeCompare(b, "zh"))) {
    const parts = rel.split("/").filter(Boolean);
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (isLast) {
        if (!node.childrenMap.has(part)) {
          node.childrenMap.set(part, {
            name: part,
            path: acc,
            isDir: false,
            childrenMap: new Map(),
          });
        }
      } else {
        let child = node.childrenMap.get(part);
        if (!child) {
          child = {
            name: part,
            path: acc,
            isDir: true,
            childrenMap: new Map(),
          };
          node.childrenMap.set(part, child);
        }
        node = child;
      }
    }
  }

  function toNode(n: Mutable): TreeNode {
    if (!n.isDir) {
      return { name: n.name, path: n.path, isDir: false };
    }
    const children = Array.from(n.childrenMap.values())
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, "zh");
      })
      .map(toNode);
    return {
      name: n.name,
      path: n.path,
      isDir: true,
      children,
    };
  }

  return toNode(root);
}

async function ensureFsPermission(
  handle: FileSystemDirectoryHandle,
  modeWanted: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  const opts = { mode: modeWanted } as FileSystemHandlePermissionDescriptor;
  let state = await handle.queryPermission!(opts);
  if (state === "granted") return true;
  state = await handle.requestPermission!(opts);
  return state === "granted";
}

async function* walkDirectory(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      yield* walkDirectory(handle as FileSystemDirectoryHandle, rel);
    } else if (handle.kind === "file" && isDocPath(name)) {
      yield { path: rel, handle: handle as FileSystemFileHandle };
    }
  }
}

async function readFileHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

async function writeFileAt(
  root: FileSystemDirectoryHandle,
  rel: string,
  content: string,
): Promise<void> {
  const parts = normalizeRel(rel).split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("无效路径");
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function listDemoDocs(): Promise<DocMeta[]> {
  ensureDemo();
  const docs: DocMeta[] = [];
  for (const [path, content] of demoFiles) {
    const kind = kindOf(path);
    const { title, tags, body } = parseMeta(kind, content);
    const name = path.split("/").pop() || path;
    docs.push({
      path,
      name,
      kind,
      title: title || name,
      tags,
      body,
    });
  }
  docs.sort((a, b) => a.path.localeCompare(b.path, "zh"));
  return docs;
}

async function listFsDocs(root: FileSystemDirectoryHandle): Promise<DocMeta[]> {
  const docs: DocMeta[] = [];
  for await (const { path, handle } of walkDirectory(root)) {
    const content = await readFileHandle(handle);
    const kind = kindOf(path);
    const { title, tags, body } = parseMeta(kind, content);
    const name = path.split("/").pop() || path;
    docs.push({
      path,
      name,
      kind,
      title: title || name,
      tags,
      body,
    });
  }
  docs.sort((a, b) => a.path.localeCompare(b.path, "zh"));
  return docs;
}

export async function browserGetDefaultLibraryPath(): Promise<string> {
  return DEMO_LIBRARY_PATH;
}

export async function browserOpenLibrary(path: string): Promise<string> {
  if (path.startsWith("fs://") && pendingLibraryHandle) {
    const ok = await ensureFsPermission(pendingLibraryHandle, "readwrite");
    if (!ok) throw new Error("未获得文件夹读写权限");
    fsRoot = pendingLibraryHandle;
    pendingLibraryHandle = null;
    mode = "fs";
    return path;
  }
  if (fsRoot && path.startsWith("fs://")) {
    mode = "fs";
    return path;
  }
  mode = "demo";
  fsRoot = null;
  ensureDemo();
  return DEMO_LIBRARY_PATH;
}

export async function browserGetTree(libraryPath: string): Promise<TreeNode> {
  void libraryPath;
  if (mode === "fs" && fsRoot) {
    const paths: string[] = [];
    for await (const { path } of walkDirectory(fsRoot)) {
      paths.push(path);
    }
    // also include empty dirs? skip for MVP
    return buildTreeFromPaths(paths, fsRoot.name || "琅嬛");
  }
  ensureDemo();
  return buildTreeFromPaths([...demoFiles.keys()], "琅嬛");
}

export async function browserGetDocuments(
  libraryPath: string,
): Promise<DocMeta[]> {
  void libraryPath;
  if (mode === "fs" && fsRoot) return listFsDocs(fsRoot);
  return listDemoDocs();
}

export async function browserReadFile(
  libraryPath: string,
  relativePath: string,
): Promise<string> {
  void libraryPath;
  const rel = normalizeRel(relativePath);
  if (!isDocPath(rel)) throw new Error("仅支持读取 .md / .html 文档");
  if (mode === "fs" && fsRoot) {
    const parts = rel.split("/").filter(Boolean);
    let dir: FileSystemDirectoryHandle = fsRoot;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return readFileHandle(fh);
  }
  ensureDemo();
  const content = demoFiles.get(rel);
  if (content === undefined) throw new Error(`文件不存在：${rel}`);
  return content;
}

export async function browserWriteFile(
  libraryPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  void libraryPath;
  const rel = normalizeRel(relativePath);
  if (!isDocPath(rel)) throw new Error("仅支持写入 .md / .html 文档");
  if (mode === "fs" && fsRoot) {
    await writeFileAt(fsRoot, rel, content);
    return;
  }
  ensureDemo();
  demoFiles.set(rel, content);
  persistDemo();
}

export async function browserCreateFile(
  libraryPath: string,
  relativeDir: string,
  name: string,
  kind: string,
  content?: string,
): Promise<string> {
  void libraryPath;
  const safe = sanitizeFilename(name);
  if (!safe) throw new Error("文件名不能为空");
  const ext = kind === "html" ? "html" : "md";
  const filename = safe.toLowerCase().endsWith(`.${ext}`)
    ? safe
    : `${safe}.${ext}`;
  const dir = normalizeRel(relativeDir);
  const rel = dir ? `${dir}/${filename}` : filename;

  const body =
    content ??
    (ext === "html"
      ? `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <title>${safe}</title>\n  <!-- tags: -->\n</head>\n<body>\n  <h1>${safe}</h1>\n  <p></p>\n</body>\n</html>\n`
      : `---\ntitle: ${safe}\ntags: []\n---\n\n# ${safe}\n\n`);

  if (mode === "fs" && fsRoot) {
    // existence check
    try {
      const parts = rel.split("/").filter(Boolean);
      let dirHandle: FileSystemDirectoryHandle = fsRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        dirHandle = await dirHandle.getDirectoryHandle(parts[i], {
          create: true,
        });
      }
      await dirHandle.getFileHandle(parts[parts.length - 1]);
      throw new Error(`已存在：${rel}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("已存在")) throw e;
      // NotFoundError → ok to create
    }
    await writeFileAt(fsRoot, rel, body);
    return rel;
  }

  ensureDemo();
  if (demoFiles.has(rel)) throw new Error(`已存在：${rel}`);
  demoFiles.set(rel, body);
  persistDemo();
  return rel;
}

export async function browserImportFromFolder(
  libraryPath: string,
  sourcePath: string,
  destRelative: string,
): Promise<number> {
  void libraryPath;
  void sourcePath;
  if (!pendingImportHandle) {
    throw new Error("未选择导入文件夹");
  }
  const src = pendingImportHandle;
  pendingImportHandle = null;
  const dest = normalizeRel(destRelative) || "导入";
  let count = 0;

  for await (const { path, handle } of walkDirectory(src)) {
    const content = await readFileHandle(handle);
    const target = `${dest}/${path}`;
    if (mode === "fs" && fsRoot) {
      await writeFileAt(fsRoot, target, content);
    } else {
      ensureDemo();
      demoFiles.set(normalizeRel(target), content);
    }
    count += 1;
  }
  if (mode === "demo") persistDemo();
  return count;
}

export async function browserSearchLibrary(
  libraryPath: string,
  query: string,
): Promise<DocMeta[]> {
  const docs = await browserGetDocuments(libraryPath);
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.path.toLowerCase().includes(q) ||
      d.body.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export async function browserPickFolder(): Promise<string | null> {
  if (!supportsDirectoryPicker()) {
    throw new Error(
      "当前浏览器不支持选择文件夹（请用最新 Chrome / Edge）。演示库仍可用：新建、粘贴、编辑均可。",
    );
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    pendingImportHandle = handle;
    return `import://${handle.name}`;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

export async function browserPickLibraryFolder(): Promise<string | null> {
  if (!supportsDirectoryPicker()) {
    throw new Error(
      "当前浏览器不支持打开本地文件夹。可继续使用内置演示库。",
    );
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    pendingLibraryHandle = handle;
    return `fs://${handle.name}`;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

export function browserModeLabel(libraryPath: string): string {
  if (libraryPath.startsWith("fs://")) {
    return `本地文件夹：${libraryPath.slice(5)}`;
  }
  return "浏览器演示库（localStorage）";
}
