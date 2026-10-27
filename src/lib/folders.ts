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
