import { dirname } from "./utils";

/** Normalize a library folder path (no leading/trailing slash, no `.`/`..`). */
export function normalizeFolderPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

/**
 * Validate a single folder name segment (not a path).
 * Rejects empty, `/` `\`, `.` / `..`, and control characters.
 */
export function sanitizeFolderSegment(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (name === "." || name === "..") return null;
  if (/[/\\]/.test(name)) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** Join parent folder + segment into a normalized library path. */
export function joinFolderPath(parent: string, segment: string): string {
  const p = normalizeFolderPath(parent);
  const s = sanitizeFolderSegment(segment);
  if (!s) return "";
  return p ? `${p}/${s}` : s;
}

/** Drop empty-folder entries that already have at least one document underneath. */
export function pruneEmptyFolders(
  emptyFolders: string[],
  docPaths: string[]
): string[] {
  const docs = docPaths.map((p) => p.replace(/\\/g, "/"));
  return emptyFolders
    .map(normalizeFolderPath)
    .filter(Boolean)
    .filter((folder) => {
      const prefix = folder + "/";
      return !docs.some((d) => d.startsWith(prefix));
    })
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, "zh"));
}

export type FolderTreeNode = {
  name: string;
  path: string;
  docs: { id: string; name: string; type: string; starred?: boolean }[];
  children: Map<string, FolderTreeNode>;
};

function ensureFolderNode(root: FolderTreeNode, folderPath: string): void {
  const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const p = parts.slice(0, i + 1).join("/");
    if (!node.children.has(name)) {
      node.children.set(name, { name, path: p, docs: [], children: new Map() });
    }
    node = node.children.get(name)!;
  }
}

/**
 * Build sidebar tree from documents, then merge persisted empty folders
 * so empty directories remain visible without ghost markdown placeholders.
 */
export function buildTree(
  docs: { id: string; path: string; type: string; starred?: boolean }[],
  emptyFolders: string[] = []
): FolderTreeNode {
  const root: FolderTreeNode = { name: "", path: "", docs: [], children: new Map() };
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
  for (const folder of emptyFolders) {
    const norm = normalizeFolderPath(folder);
    if (norm) ensureFolderNode(root, norm);
  }
  return root;
}

/** Parent directory for 「新建文件夹」: active doc dirname, else root. */
export function parentFolderForNew(activePath: string | null | undefined): string {
  if (!activePath) return "";
  return dirname(activePath.replace(/\\/g, "/"));
}

/** True if docPath is strictly under folderPath (not the folder itself). Root "" never matches. */
export function isPathUnderFolder(docPath: string, folderPath: string): boolean {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return false;
  return docPath.replace(/\\/g, "/").startsWith(folder + "/");
}

/** Drop a folder and all its descendant empty-folder entries. */
export function removeFolderAndDescendants(
  emptyFolders: string[],
  folderPath: string
): string[] {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) {
    return emptyFolders.map(normalizeFolderPath).filter(Boolean);
  }
  const prefix = folder + "/";
  return emptyFolders
    .map(normalizeFolderPath)
    .filter((f) => f && f !== folder && !f.startsWith(prefix))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, "zh"));
}

export type ParseFolderInputOk = {
  ok: true;
  segments: string[];
  fullPath: string;
};

export type ParseFolderInputErr = {
  ok: false;
  reason: string;
};

export type ParseFolderInputResult = ParseFolderInputOk | ParseFolderInputErr;

/**
 * Parse user folder input that may contain nested segments (`算法/图论`).
 * Leading `/` (or `\`) ignores parentPath and starts from library root.
 * Each segment still goes through sanitizeFolderSegment.
 */
export function parseFolderInput(
  raw: string,
  parentPath = ""
): ParseFolderInputResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "路径不能为空" };
  }
  const fromRoot = trimmed.startsWith("/") || trimmed.startsWith("\\");
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return { ok: false, reason: "路径不能为空" };
  }
  const parts = normalized.split("/");
  const segments: string[] = [];
  for (const part of parts) {
    if (part === "") {
      return { ok: false, reason: "路径中不能有空段" };
    }
    if (part === "." || part === "..") {
      return { ok: false, reason: "路径中不能包含 . 或 .." };
    }
    const seg = sanitizeFolderSegment(part);
    if (!seg) {
      return {
        ok: false,
        reason: "文件夹名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）",
      };
    }
    segments.push(seg);
  }
  const parent = fromRoot ? "" : normalizeFolderPath(parentPath || "");
  const fullPath = parent ? `${parent}/${segments.join("/")}` : segments.join("/");
  return { ok: true, segments, fullPath };
}

/** Collect every folder path present in the doc tree + emptyFolders (sorted). */
export function listFolderPaths(
  docs: { path: string; type?: string }[],
  emptyFolders: string[] = []
): string[] {
  const tree = buildTree(
    docs.map((d) => ({
      id: d.path,
      path: d.path,
      type: d.type || "md",
    })),
    emptyFolders
  );
  const out: string[] = [];
  const walk = (node: FolderTreeNode) => {
    for (const child of node.children.values()) {
      out.push(child.path);
      walk(child);
    }
  };
  walk(tree);
  return out.sort((a, b) => a.localeCompare(b, "zh"));
}

/** True if folder path already exists (has docs underneath or in emptyFolders). */
export function folderExists(
  folderPath: string,
  docPaths: string[],
  emptyFolders: string[]
): boolean {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return true; // library root always "exists"
  if (emptyFolders.map(normalizeFolderPath).includes(folder)) return true;
  const prefix = folder + "/";
  if (docPaths.some((d) => d.replace(/\\/g, "/").startsWith(prefix))) return true;
  if (
    emptyFolders
      .map(normalizeFolderPath)
      .some((f) => f.startsWith(prefix))
  ) {
    return true;
  }
  return false;
}

/** Remap emptyFolders entries when a folder is renamed/moved (prefix replace). */
export function remapEmptyFolders(
  emptyFolders: string[],
  oldPath: string,
  newPath: string
): string[] {
  const old = normalizeFolderPath(oldPath);
  const neu = normalizeFolderPath(newPath);
  if (!old) return emptyFolders.map(normalizeFolderPath).filter(Boolean);
  const prefix = old + "/";
  return emptyFolders
    .map(normalizeFolderPath)
    .filter(Boolean)
    .map((f) => {
      if (f === old) return neu;
      if (f.startsWith(prefix)) return neu + f.slice(old.length);
      return f;
    })
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, "zh"));
}

/** True if candidateParent is oldPath itself or a descendant of oldPath. */
export function isSelfOrDescendantFolder(
  oldPath: string,
  candidateParent: string
): boolean {
  const old = normalizeFolderPath(oldPath);
  const cand = normalizeFolderPath(candidateParent);
  if (!old) return true;
  if (!cand) return false;
  if (cand === old) return true;
  return cand.startsWith(old + "/");
}

export type DocTypeExt = "md" | "html";

export type ParseDocPathInputOk = {
  ok: true;
  /** Full library-relative path including extension. */
  fullPath: string;
  /** Parent folder path ("" = library root). */
  folderPath: string;
  fileName: string;
};

export type ParseDocPathInputResult = ParseDocPathInputOk | ParseFolderInputErr;

/** Default filename when the user leaves the name field empty. */
export function defaultDocFileName(type: DocTypeExt): string {
  return type === "md" ? "未命名笔记.md" : "未命名页面.html";
}

/**
 * Sanitize a single document filename (last path segment).
 * Forces the extension to match `type`. Rejects `.` / `..` and path separators.
 */
export function sanitizeDocFileName(
  raw: string,
  type: DocTypeExt
): string | null {
  let name = raw.trim();
  if (!name) return null;
  if (name === "." || name === "..") return null;
  if (/[/\\]/.test(name)) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  // Strip Windows-forbidden characters in filenames.
  name = name.replace(/[?%*:|"<>]/g, "-");
  const ext = type === "md" ? ".md" : ".html";
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".html") || lower.endsWith(".htm")) {
    name = name.replace(/\.(md|html|htm)$/i, "");
  }
  name = name.trim();
  if (!name || name === "." || name === "..") return null;
  return name + ext;
}

/**
 * Parse user document path input (may nest folders: `算法/图论/最短路`).
 * Empty `raw` → default unnamed file under parent.
 * Leading `/` ignores parentPath (library-root absolute).
 */
export function parseDocPathInput(
  raw: string,
  parentPath: string,
  type: DocTypeExt
): ParseDocPathInputResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    const fileName = defaultDocFileName(type);
    const parent = normalizeFolderPath(parentPath || "");
    const fullPath = parent ? `${parent}/${fileName}` : fileName;
    return { ok: true, fullPath, folderPath: parent, fileName };
  }
  const fromRoot = trimmed.startsWith("/") || trimmed.startsWith("\\");
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    const fileName = defaultDocFileName(type);
    return { ok: true, fullPath: fileName, folderPath: "", fileName };
  }
  const parts = normalized.split("/");
  if (parts.some((p) => p === "")) {
    return { ok: false, reason: "路径中不能有空段" };
  }
  const fileRaw = parts[parts.length - 1]!;
  const folderSegs = parts.slice(0, -1);
  for (const part of folderSegs) {
    if (part === "." || part === "..") {
      return { ok: false, reason: "路径中不能包含 . 或 .." };
    }
    const seg = sanitizeFolderSegment(part);
    if (!seg) {
      return {
        ok: false,
        reason: "文件夹名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）",
      };
    }
  }
  const fileName = sanitizeDocFileName(fileRaw, type);
  if (!fileName) {
    return {
      ok: false,
      reason: "文件名无效（不能为空、. / ..，也不能含 / \\ 或控制字符）",
    };
  }
  const parent = fromRoot ? "" : normalizeFolderPath(parentPath || "");
  const folderJoined = folderSegs
    .map((p) => sanitizeFolderSegment(p)!)
    .join("/");
  const folderPath = parent
    ? folderJoined
      ? `${parent}/${folderJoined}`
      : parent
    : folderJoined;
  const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
  return { ok: true, fullPath, folderPath, fileName };
}
