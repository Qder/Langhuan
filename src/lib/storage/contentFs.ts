/**
 * Server-side library rooted at process.cwd()/content.
 * Node runtime only — do not import from client components.
 */
import { promises as fs } from "fs";
import path from "path";
import type { AssetMeta, Document, TrashItem } from "../types";
import { libraryDocTypeFromPath, normalizeImportedPath } from "../importable";
import { FS_INDEX_DIR, FS_INDEX_FILE } from "./constants";
import { safeRelPath } from "./pathSanitize";
import { normalizeNewlines } from "../utils";

export { safeRelPath };

export const CONTENT_DIRNAME = "content";
export const ASSETS_INDEX_FILE = "assets.json";
export const TRASH_INDEX_FILE = "trash.json";

export type FsIndexEntry = {
  id: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
};

export type FsIndex = {
  format: "langhuan-fs-index";
  version: 1;
  updatedAt: number;
  documents: Record<string, FsIndexEntry>;
};

export type LibrarySnapshot = {
  documents: Document[];
  assets: AssetMeta[];
  trash: TrashItem[];
};

const TEXT_DOC_RE = /\.(md|html|htm|txt|svg)$/i;
const IMAGE_ASSET_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;

export function contentRoot(): string {
  return path.join(process.cwd(), CONTENT_DIRNAME);
}

export function metaDir(): string {
  return path.join(contentRoot(), FS_INDEX_DIR);
}

function absFromRel(rel: string): string {
  const clean = safeRelPath(rel);
  if (!clean) throw new Error("路径无效");
  const root = contentRoot();
  const abs = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error("路径越界");
  }
  return abs;
}

export async function ensureContentTree(): Promise<void> {
  await fs.mkdir(metaDir(), { recursive: true });
}

export function emptyIndex(): FsIndex {
  return {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: Date.now(),
    documents: {},
  };
}

export async function readIndex(): Promise<FsIndex> {
  const file = path.join(metaDir(), FS_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as FsIndex;
    if (parsed.format !== "langhuan-fs-index" || !parsed.documents) {
      return emptyIndex();
    }
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export async function writeIndex(index: FsIndex): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), FS_INDEX_FILE);
  await fs.writeFile(file, JSON.stringify(index, null, 2) + "\n", "utf8");
}

export async function readAssetsIndex(): Promise<AssetMeta[]> {
  const file = path.join(metaDir(), ASSETS_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AssetMeta[]) : [];
  } catch {
    return [];
  }
}

export async function writeAssetsIndex(list: AssetMeta[]): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), ASSETS_INDEX_FILE);
  await fs.writeFile(file, JSON.stringify(list, null, 2) + "\n", "utf8");
}

export async function readTrashIndex(): Promise<TrashItem[]> {
  const file = path.join(metaDir(), TRASH_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrashItem[]) : [];
  } catch {
    return [];
  }
}

export async function writeTrashIndex(list: TrashItem[]): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), TRASH_INDEX_FILE);
  await fs.writeFile(file, JSON.stringify(list, null, 2) + "\n", "utf8");
}

async function walkFiles(dir: string, prefix: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === FS_INDEX_DIR) continue;
      await walkFiles(abs, rel, out);
    } else if (ent.isFile()) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
}

export async function listRelativeFiles(): Promise<string[]> {
  await ensureContentTree();
  const out: string[] = [];
  await walkFiles(contentRoot(), "", out);
  return out;
}

function mimeForPath(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

export function isTextDocPath(rel: string): boolean {
  return TEXT_DOC_RE.test(rel);
}

export function isImageAssetPath(rel: string): boolean {
  return IMAGE_ASSET_RE.test(rel);
}

function newId(prefix = "fs"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export async function scanLibrary(): Promise<LibrarySnapshot> {
  await ensureContentTree();
  const index = await readIndex();
  const assetsMeta = await readAssetsIndex();
  const trash = await readTrashIndex();
  const files = await listRelativeFiles();

  const documents: Document[] = [];
  const assetByPath = new Map(assetsMeta.map((a) => [safeRelPath(a.path), a]));
  const seenAssetPaths = new Set<string>();

  for (const raw of files) {
    let rel = safeRelPath(raw);
    if (!rel) continue;
    if (isTextDocPath(rel)) {
      const abs = absFromRel(rel);
      const content = normalizeNewlines(await fs.readFile(abs, "utf8"));
      const st = await fs.stat(abs);
      const normalized = normalizeImportedPath(rel);
      const meta = index.documents[normalized] || index.documents[rel];
      const type = libraryDocTypeFromPath(normalized);
      documents.push({
        id: meta?.id || newId("doc"),
        path: normalized,
        type,
        content,
        starred: meta?.starred ?? false,
        createdAt: meta?.createdAt ?? st.mtimeMs,
        updatedAt: meta?.updatedAt ?? st.mtimeMs,
      });
      continue;
    }
    if (isImageAssetPath(rel)) {
      const abs = absFromRel(rel);
      const st = await fs.stat(abs);
      const existing = assetByPath.get(rel);
      const meta: AssetMeta = existing
        ? { ...existing, path: rel, size: st.size }
        : {
            id: newId("asset"),
            path: rel,
            mime: mimeForPath(rel),
            size: st.size,
            createdAt: st.mtimeMs,
          };
      seenAssetPaths.add(rel);
      assetByPath.set(rel, meta);
    }
  }

  const assets = Array.from(assetByPath.values()).filter(
    (a) => seenAssetPaths.has(safeRelPath(a.path)) || IMAGE_ASSET_RE.test(a.path)
  );
  // Prefer disk-present assets; drop metas whose files are gone
  const present = assets.filter((a) => seenAssetPaths.has(safeRelPath(a.path)));

  // Refresh index ids for scanned docs
  const now = Date.now();
  const nextIndex = emptyIndex();
  nextIndex.updatedAt = now;
  for (const d of documents) {
    const p = safeRelPath(d.path);
    nextIndex.documents[p] = {
      id: d.id,
      starred: d.starred,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lastSyncedAt: now,
    };
  }
  await writeIndex(nextIndex);
  await writeAssetsIndex(present);

  return { documents, assets: present, trash };
}

export async function readFileBytes(
  relPath: string
): Promise<{ buf: Buffer; mime: string; rel: string } | null> {
  const rel = safeRelPath(relPath);
  if (!rel) return null;
  try {
    const abs = absFromRel(rel);
    const buf = await fs.readFile(abs);
    return { buf, mime: mimeForPath(rel), rel };
  } catch {
    return null;
  }
}

export async function writeTextDoc(doc: {
  path: string;
  content: string;
  id: string;
  starred?: boolean;
  createdAt?: number;
  updatedAt?: number;
  previousPath?: string;
}): Promise<Document> {
  await ensureContentTree();
  const rel = safeRelPath(doc.path);
  if (!rel) throw new Error("路径无效");
  if (doc.previousPath) {
    const prev = safeRelPath(doc.previousPath);
    if (prev && prev !== rel) {
      try {
        await fs.unlink(absFromRel(prev));
      } catch {
        /* missing ok */
      }
    }
  }
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, doc.content, "utf8");
  const now = Date.now();
  const index = await readIndex();
  if (doc.previousPath) {
    const prev = safeRelPath(doc.previousPath);
    if (prev && prev !== rel) delete index.documents[prev];
  }
  const prevMeta = index.documents[rel];
  const entry: FsIndexEntry = {
    id: doc.id || prevMeta?.id || newId("doc"),
    starred: doc.starred ?? prevMeta?.starred ?? false,
    createdAt: doc.createdAt ?? prevMeta?.createdAt ?? now,
    updatedAt: doc.updatedAt ?? now,
    lastSyncedAt: now,
  };
  index.documents[rel] = entry;
  index.updatedAt = now;
  await writeIndex(index);
  return {
    id: entry.id,
    path: normalizeImportedPath(rel),
    type: libraryDocTypeFromPath(rel),
    content: doc.content,
    starred: entry.starred,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export async function writeAssetBinary(input: {
  path: string;
  data: Buffer;
  mime?: string;
  id?: string;
  docId?: string;
  createdAt?: number;
}): Promise<AssetMeta> {
  await ensureContentTree();
  const rel = safeRelPath(input.path);
  if (!rel) throw new Error("路径无效");
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.data);
  const list = await readAssetsIndex();
  const existing = list.find((a) => safeRelPath(a.path) === rel);
  const meta: AssetMeta = {
    id: input.id || existing?.id || newId("asset"),
    path: rel,
    mime: input.mime || existing?.mime || mimeForPath(rel),
    size: input.data.length,
    createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
    docId: input.docId ?? existing?.docId,
  };
  const next = list.filter((a) => safeRelPath(a.path) !== rel);
  next.push(meta);
  await writeAssetsIndex(next);
  return meta;
}

export async function softDeleteDoc(relPath: string): Promise<TrashItem | null> {
  const rel = safeRelPath(relPath);
  if (!rel) return null;
  const index = await readIndex();
  const meta = index.documents[rel];
  let content = "";
  try {
    content = normalizeNewlines(await fs.readFile(absFromRel(rel), "utf8"));
  } catch {
    return null;
  }
  const doc: Document = {
    id: meta?.id || newId("doc"),
    path: normalizeImportedPath(rel),
    type: libraryDocTypeFromPath(rel),
    content,
    starred: meta?.starred ?? false,
    createdAt: meta?.createdAt ?? Date.now(),
    updatedAt: meta?.updatedAt ?? Date.now(),
  };
  try {
    await fs.unlink(absFromRel(rel));
  } catch {
    /* ignore */
  }
  delete index.documents[rel];
  index.updatedAt = Date.now();
  await writeIndex(index);
  const item: TrashItem = { doc, deletedAt: Date.now() };
  const trash = await readTrashIndex();
  const next = [item, ...trash.filter((t) => t.doc.id !== doc.id)];
  await writeTrashIndex(next);
  return item;
}

export async function hardDeletePath(relPath: string): Promise<boolean> {
  const rel = safeRelPath(relPath);
  if (!rel) return false;
  try {
    await fs.unlink(absFromRel(rel));
  } catch {
    /* missing */
  }
  const index = await readIndex();
  if (index.documents[rel]) {
    delete index.documents[rel];
    index.updatedAt = Date.now();
    await writeIndex(index);
  }
  const assets = await readAssetsIndex();
  const nextAssets = assets.filter((a) => safeRelPath(a.path) !== rel);
  if (nextAssets.length !== assets.length) await writeAssetsIndex(nextAssets);
  return true;
}

export async function restoreTrashItem(id: string): Promise<Document | null> {
  const trash = await readTrashIndex();
  const item = trash.find((t) => t.doc.id === id);
  if (!item) return null;
  const written = await writeTextDoc({
    path: item.doc.path,
    content: item.doc.content,
    id: item.doc.id,
    starred: item.doc.starred,
    createdAt: item.doc.createdAt,
    updatedAt: Date.now(),
  });
  await writeTrashIndex(trash.filter((t) => t.doc.id !== id));
  return written;
}

export async function purgeTrashItem(id: string): Promise<boolean> {
  const trash = await readTrashIndex();
  const next = trash.filter((t) => t.doc.id !== id);
  if (next.length === trash.length) return false;
  await writeTrashIndex(next);
  return true;
}

export async function ensureLibraryDir(relDir: string): Promise<void> {
  const rel = safeRelPath(relDir);
  if (!rel) return;
  await fs.mkdir(absFromRel(rel), { recursive: true });
}

/** Merge helpers for tests / index planning. */
export function mergeIndexEntry(
  index: FsIndex,
  doc: Pick<Document, "id" | "path" | "starred" | "createdAt" | "updatedAt">,
  now = Date.now()
): FsIndex {
  const p = safeRelPath(doc.path);
  if (!p) return index;
  return {
    ...index,
    updatedAt: now,
    documents: {
      ...index.documents,
      [p]: {
        id: doc.id,
        starred: doc.starred,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        lastSyncedAt: now,
      },
    },
  };
}
