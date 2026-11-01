/**
 * Server-side library rooted at process.cwd()/content.
 * Node runtime only — do not import from client components.
 */
import { promises as fs } from "fs";
import path from "path";
import type { AssetMeta, Document, TrashItem } from "../types";
import { libraryDocTypeFromPath, normalizeImportedPath } from "../importable";
import { FS_INDEX_DIR, FS_INDEX_FILE, FS_QUIZ_FILE } from "./constants";
import {
  emptyQuizStore,
  normalizeQuizStore,
  type QuizStoreFile,
} from "../quiz";
import { safeRelPath } from "./pathSanitize";
import { normalizeNewlines } from "../utils";
import {
  PROJECT_META_DIR,
  PROJECT_META_FILE,
  parseProjectMeta,
  projectMetaPath,
  type ProjectMeta,
} from "../project";
import {
  CSS_INDEX_DIR,
  cssIndexPath,
  parseCssIndex,
  type CssFileIndex,
} from "../locate/cssLocate";
import {
  JS_INDEX_DIR,
  jsIndexPath,
  parseJsIndex,
  type JsFileIndex,
} from "../locate/jsIndex";

export { safeRelPath };

export const CONTENT_DIRNAME = "content";
export const ASSETS_INDEX_FILE = "assets.json";
export const TRASH_INDEX_FILE = "trash.json";
export const QUIZ_INDEX_FILE = FS_QUIZ_FILE;

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
  /** 项目元数据（content/<root>/.langhuan/project.json） */
  projects?: ProjectMeta[];
  /** 内联用的项目文本缓存：root → 项目内相对路径 → 内容 */
  projectTexts?: Record<string, Record<string, string>>;
  /** CSS 索引（content/.langhuan/index/css/*.json） */
  cssIndexes?: CssFileIndex[];
  /** JS 符号索引（content/.langhuan/index/js/*.json） */
  jsIndexes?: JsFileIndex[];
};

/** 项目里参与「预览内联」的文本类型（只读这几个，避免把大 JSON 全塞进快照）。 */
const PROJECT_INLINE_RE = /\.(css|js|mjs|cjs)$/i;

/** 单个项目文本文件进快照的上限。 */
export const PROJECT_TEXT_MAX_BYTES = 512 * 1024;

/** 单个项目文本总量上限。 */
export const PROJECT_TEXT_TOTAL_MAX_BYTES = 4 * 1024 * 1024;

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

export async function readQuizStore(): Promise<QuizStoreFile> {
  const file = path.join(metaDir(), QUIZ_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    return normalizeQuizStore(JSON.parse(raw));
  } catch {
    return emptyQuizStore();
  }
}

export async function writeQuizStore(store: QuizStoreFile): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), QUIZ_INDEX_FILE);
  const payload: QuizStoreFile = {
    format: "langhuan-quiz",
    version: 1,
    updatedAt: store.updatedAt || Date.now(),
    docs: Array.isArray(store.docs) ? store.docs : [],
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
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
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json") || lower.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
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
    const rel = safeRelPath(raw);
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

  const { projects, projectTexts } = await readProjectSnapshot();
  const cssIndexes = await readCssIndexes();
  const jsIndexes = await readJsIndexes();
  return { documents, assets: present, trash, projects, projectTexts, cssIndexes, jsIndexes };
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

/* ——————————————————— 项目（多文件站点） ——————————————————— */

async function isFile(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 找出所有项目根：同时含 `<root>/.langhuan/project.json` 的目录。
 * 跳过 node_modules / .git 等下钻，避免深目录拖慢扫描。
 */
export async function listProjectRoots(): Promise<string[]> {
  await ensureContentTree();
  const out: string[] = [];
  const walk = async (abs: string, rel: string) => {
    let ents;
    try {
      ents = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      if (ent.name === PROJECT_META_DIR) continue;
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const childAbs = path.join(abs, ent.name);
      if (await isFile(path.join(childAbs, PROJECT_META_DIR, PROJECT_META_FILE))) {
        out.push(childRel);
      }
      await walk(childAbs, childRel);
    }
  };
  await walk(contentRoot(), "");
  return out;
}

/**
 * 读全部项目元数据 + 内联用的文本缓存（css/js，带大小上限）。
 * 坏掉的 project.json 只跳过该项目，不影响其它项目。
 */
export async function readProjectSnapshot(): Promise<{
  projects: ProjectMeta[];
  projectTexts: Record<string, Record<string, string>>;
}> {
  const projects: ProjectMeta[] = [];
  const projectTexts: Record<string, Record<string, string>> = {};
  for (const root of await listProjectRoots()) {
    try {
      const raw = await fs.readFile(absFromRel(projectMetaPath(root)), "utf8");
      const meta = parseProjectMeta(JSON.parse(raw), root);
      if (!meta) continue;
      const texts: Record<string, string> = {};
      let total = 0;
      for (const rel of meta.files) {
        if (!PROJECT_INLINE_RE.test(rel)) continue;
        const abs = absFromRel(`${root}/${rel}`);
        const st = await fs.stat(abs).catch(() => null);
        if (!st || !st.isFile() || st.size > PROJECT_TEXT_MAX_BYTES) continue;
        if (total + st.size > PROJECT_TEXT_TOTAL_MAX_BYTES) break;
        texts[rel] = normalizeNewlines(await fs.readFile(abs, "utf8"));
        total += st.size;
      }
      projects.push(meta);
      projectTexts[root] = texts;
    } catch {
      /* 单个项目损坏不影响整体 */
    }
  }
  projects.sort((a, b) => a.root.localeCompare(b.root, "zh"));
  return { projects, projectTexts };
}

/** 原样写一个文本文件（项目资源：css/js/其他），不进正文索引。 */
export async function writeRawTextFile(relPath: string, content: string): Promise<string> {
  await ensureContentTree();
  const rel = assertNotLibraryMeta(relPath);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return rel;
}

/** 原样写一个二进制文件（项目里的图片等），不进附件索引。 */
export async function writeRawBase64File(relPath: string, base64: string): Promise<string> {
  await ensureContentTree();
  const rel = assertNotLibraryMeta(relPath);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(base64, "base64"));
  return rel;
}

/** 库级 `.langhuan/` 放索引/回收站，不接受项目资源写入（项目元数据在 `<root>/.langhuan/`）。 */
function assertNotLibraryMeta(relPath: string): string {
  const rel = safeRelPath(relPath);
  if (!rel) throw new Error("路径无效");
  if (rel === FS_INDEX_DIR || rel.startsWith(`${FS_INDEX_DIR}/`)) {
    throw new Error("不能写入库元数据目录 .langhuan/");
  }
  return rel;
}

/* ——————————————————— CSS 索引（选择器 → 文件行号） ——————————————————— */

const CSS_INDEX_MAX_BYTES = 4 * 1024 * 1024;

/** 写一个 CSS 索引文件：content/.langhuan/index/css/<hash>.json（源文件不动）。 */
export async function writeCssIndex(index: CssFileIndex): Promise<string> {
  await ensureContentTree();
  const rel = cssIndexPath(index.file);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return rel;
}

/** 读全部 CSS 索引；坏文件 / 超大文件跳过，不影响其它。 */
export async function readCssIndexes(): Promise<CssFileIndex[]> {
  await ensureContentTree();
  const dir = absFromRel(CSS_INDEX_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: CssFileIndex[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const abs = path.join(dir, name);
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > CSS_INDEX_MAX_BYTES) continue;
      const parsed = parseCssIndex(JSON.parse(await fs.readFile(abs, "utf8")));
      if (parsed) out.push(parsed);
    } catch {
      /* 坏索引跳过 */
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file, "zh"));
  return out;
}

/* ——————————————————— JS 索引（选择器 / 事件绑定 → 文件行号） ——————————————————— */

const JS_INDEX_MAX_BYTES = 4 * 1024 * 1024;

/** 写一个 JS 符号索引：content/.langhuan/index/js/<hash>.json（源文件不动）。 */
export async function writeJsIndex(index: JsFileIndex): Promise<string> {
  await ensureContentTree();
  const rel = jsIndexPath(index.file);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return rel;
}

/** 读全部 JS 索引；坏文件 / 超大文件跳过，不影响其它。删掉能重建。 */
export async function readJsIndexes(): Promise<JsFileIndex[]> {
  await ensureContentTree();
  const dir = absFromRel(JS_INDEX_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: JsFileIndex[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const abs = path.join(dir, name);
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > JS_INDEX_MAX_BYTES) continue;
      const parsed = parseJsIndex(JSON.parse(await fs.readFile(abs, "utf8")));
      if (parsed) out.push(parsed);
    } catch {
      /* 坏索引跳过 */
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file, "zh"));
  return out;
}
