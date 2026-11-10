import { isLearningPath, parseLearningFile, type LearningFile } from "./learningData";
/**
 * Server-side library rooted at process.cwd()/content.
 * Node runtime only — do not import from client components.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
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

/** One process-wide queue, including Next route bundles/HMR. Never nest it. */
const metaQueue = globalThis as typeof globalThis & { __langhuanMetaTail?: Promise<unknown> };
function withLibraryLock<T>(task: () => Promise<T>): Promise<T> {
  const run = (metaQueue.__langhuanMetaTail ?? Promise.resolve()).then(task, task);
  metaQueue.__langhuanMetaTail = run.catch(() => undefined);
  return run;
}

/** Same-directory replacement; a failed rename never deletes the destination.
 * No unlink-and-retry fallback on Windows/filesystems that reject replacement.
 */
async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(tmp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

async function unlinkIfPresent(file: string): Promise<void> {
  try { await fs.unlink(file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}

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

/** Resolve a library-relative path under content/; throws 路径无效 / 路径越界. */
export function absFromRel(rel: string): string {
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
      throw new Error("index.json 格式无效，已停止写入以保护元数据");
    }
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyIndex();
    throw e;
  }
}

async function writeIndexUnlocked(index: FsIndex): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), FS_INDEX_FILE);
  await atomicWrite(file, JSON.stringify(index, null, 2) + "\n");
}

export async function readAssetsIndex(): Promise<AssetMeta[]> {
  const file = path.join(metaDir(), ASSETS_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Assets 元数据格式无效");
    return parsed as AssetMeta[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeAssetsIndexUnlocked(list: AssetMeta[]): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), ASSETS_INDEX_FILE);
  await atomicWrite(file, JSON.stringify(list, null, 2) + "\n");
}

export async function readTrashIndex(): Promise<TrashItem[]> {
  const file = path.join(metaDir(), TRASH_INDEX_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Trash 元数据格式无效");
    return parsed as TrashItem[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeTrashIndexUnlocked(list: TrashItem[]): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), TRASH_INDEX_FILE);
  await atomicWrite(file, JSON.stringify(list, null, 2) + "\n");
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

async function writeQuizStoreUnlocked(store: QuizStoreFile): Promise<void> {
  await ensureContentTree();
  const file = path.join(metaDir(), QUIZ_INDEX_FILE);
  const payload: QuizStoreFile = {
    format: "langhuan-quiz",
    version: 1,
    updatedAt: store.updatedAt || Date.now(),
    docs: Array.isArray(store.docs) ? store.docs : [],
  };
  const rel = `${FS_INDEX_DIR}/${QUIZ_INDEX_FILE}`;
  parseLearningFile(rel, JSON.stringify(payload));
  await readLearningFileUnlocked(rel);
  await atomicWrite(file, JSON.stringify(payload, null, 2) + "\n");
}


async function walkFiles(dir: string, prefix: string, out: string[]): Promise<void> {
  // An incomplete scan must not replace the complete persisted index.
  const entries = await fs.readdir(dir, { withFileTypes: true });
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
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
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

async function scanLibraryUnlocked(): Promise<LibrarySnapshot> {
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
  await writeIndexUnlocked(nextIndex);
  await writeAssetsIndexUnlocked(present);

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

async function writeTextDocUnlocked(doc: {
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
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const index = await readIndex();
  if (doc.previousPath && safeRelPath(doc.previousPath) !== rel) {
    const target = index.documents[rel];
    if (target && target.id !== doc.id) throw new Error("移动目标已被其他笔记占用");
    if (!target) {
      // Permit retrying an identical orphan left by a failed index commit.
      const existing = await fs.readFile(abs, "utf8").catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return undefined;
        throw e;
      });
      if (existing !== undefined && existing !== doc.content) throw new Error("移动目标已被其他文件占用");
    }
  }
  await atomicWrite(abs, doc.content);
  const now = Date.now();
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
  await writeIndexUnlocked(index);
  // A leftover old file is safer than undoing an already committed new file.
  if (doc.previousPath) {
    const prev = safeRelPath(doc.previousPath);
    if (prev && prev !== rel) await unlinkIfPresent(absFromRel(prev)).catch(() => undefined);
  }
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

async function writeAssetBinaryUnlocked(input: {
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
  const list = await readAssetsIndex();
  await atomicWrite(abs, input.data);
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
  await writeAssetsIndexUnlocked(next);
  return meta;
}

async function softDeleteDocUnlocked(relPath: string): Promise<TrashItem | null> {
  const rel = safeRelPath(relPath);
  if (!rel) return null;
  const index = await readIndex();
  const meta = index.documents[rel];
  let content = "";
  try {
    content = normalizeNewlines(await fs.readFile(absFromRel(rel), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
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
  const item: TrashItem = { doc, deletedAt: Date.now() };
  const trash = await readTrashIndex();
  const next = [item, ...trash.filter((t) => t.doc.id !== doc.id)];
  await writeTrashIndexUnlocked(next);
  await unlinkIfPresent(absFromRel(rel));
  delete index.documents[rel];
  index.updatedAt = Date.now();
  await writeIndexUnlocked(index);
  return item;
}

async function hardDeletePathUnlocked(relPath: string): Promise<boolean> {
  const rel = safeRelPath(relPath);
  if (!rel) return false;
  const index = await readIndex();
  const assets = await readAssetsIndex();
  if (index.documents[rel]) {
    delete index.documents[rel];
    index.updatedAt = Date.now();
    await writeIndexUnlocked(index);
  }
  const nextAssets = assets.filter((a) => safeRelPath(a.path) !== rel);
  if (nextAssets.length !== assets.length) await writeAssetsIndexUnlocked(nextAssets);
  // Metadata failure leaves the binary available for retry / rescan.
  await unlinkIfPresent(absFromRel(rel));
  return true;
}

async function restoreTrashItemUnlocked(id: string): Promise<Document | null> {
  const trash = await readTrashIndex();
  const item = trash.find((t) => t.doc.id === id);
  if (!item) return null;
  const index = await readIndex();
  const original = safeRelPath(item.doc.path);
  const ext = path.posix.extname(original);
  const stem = original.slice(0, original.length - ext.length);
  let target = original;
  for (let n = 1; ; n++) {
    const occupied = Boolean(index.documents[target]) || await fs.lstat(absFromRel(target)).then(() => true, (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return false;
      throw e;
    });
    if (!occupied) break;
    target = `${stem} (${n})${ext}`;
  }
  const written = await writeTextDocUnlocked({
    path: target,
    content: item.doc.content,
    id: Object.values(index.documents).some((entry) => entry.id === item.doc.id) ? newId("doc") : item.doc.id,
    starred: item.doc.starred,
    createdAt: item.doc.createdAt,
    updatedAt: Date.now(),
  });
  await writeTrashIndexUnlocked(trash.filter((t) => t.doc.id !== id));
  return written;
}

async function purgeTrashItemUnlocked(id: string): Promise<boolean> {
  const trash = await readTrashIndex();
  const next = trash.filter((t) => t.doc.id !== id);
  if (next.length === trash.length) return false;
  await writeTrashIndexUnlocked(next);
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
async function writeRawTextFileUnlocked(relPath: string, content: string): Promise<string> {
  await ensureContentTree();
  const rel = assertNotLibraryMeta(relPath);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWrite(abs, content);
  return rel;
}

/** 原样写一个二进制文件（项目里的图片等），不进附件索引。 */
async function writeRawBase64FileUnlocked(relPath: string, base64: string): Promise<string> {
  await ensureContentTree();
  const rel = assertNotLibraryMeta(relPath);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWrite(abs, Buffer.from(base64, "base64"));
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
async function writeCssIndexUnlocked(index: CssFileIndex): Promise<string> {
  await ensureContentTree();
  const rel = cssIndexPath(index.file);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWrite(abs, `${JSON.stringify(index, null, 2)}\n`);
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
async function writeJsIndexUnlocked(index: JsFileIndex): Promise<string> {
  await ensureContentTree();
  const rel = jsIndexPath(index.file);
  const abs = absFromRel(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await atomicWrite(abs, `${JSON.stringify(index, null, 2)}\n`);
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

export function writeIndex(...args: Parameters<typeof writeIndexUnlocked>): ReturnType<typeof writeIndexUnlocked> {
  return withLibraryLock(() => writeIndexUnlocked(...args));
}

export function writeAssetsIndex(...args: Parameters<typeof writeAssetsIndexUnlocked>): ReturnType<typeof writeAssetsIndexUnlocked> {
  return withLibraryLock(() => writeAssetsIndexUnlocked(...args));
}

export function writeTrashIndex(...args: Parameters<typeof writeTrashIndexUnlocked>): ReturnType<typeof writeTrashIndexUnlocked> {
  return withLibraryLock(() => writeTrashIndexUnlocked(...args));
}

export function writeQuizStore(...args: Parameters<typeof writeQuizStoreUnlocked>): ReturnType<typeof writeQuizStoreUnlocked> {
  return withLibraryLock(() => writeQuizStoreUnlocked(...args));
}

export function scanLibrary(...args: Parameters<typeof scanLibraryUnlocked>): ReturnType<typeof scanLibraryUnlocked> {
  return withLibraryLock(() => scanLibraryUnlocked(...args));
}

export function writeTextDoc(...args: Parameters<typeof writeTextDocUnlocked>): ReturnType<typeof writeTextDocUnlocked> {
  return withLibraryLock(() => writeTextDocUnlocked(...args));
}

export function writeAssetBinary(...args: Parameters<typeof writeAssetBinaryUnlocked>): ReturnType<typeof writeAssetBinaryUnlocked> {
  return withLibraryLock(() => writeAssetBinaryUnlocked(...args));
}

export function softDeleteDoc(...args: Parameters<typeof softDeleteDocUnlocked>): ReturnType<typeof softDeleteDocUnlocked> {
  return withLibraryLock(() => softDeleteDocUnlocked(...args));
}

export function hardDeletePath(...args: Parameters<typeof hardDeletePathUnlocked>): ReturnType<typeof hardDeletePathUnlocked> {
  return withLibraryLock(() => hardDeletePathUnlocked(...args));
}

export function restoreTrashItem(...args: Parameters<typeof restoreTrashItemUnlocked>): ReturnType<typeof restoreTrashItemUnlocked> {
  return withLibraryLock(() => restoreTrashItemUnlocked(...args));
}

export function purgeTrashItem(...args: Parameters<typeof purgeTrashItemUnlocked>): ReturnType<typeof purgeTrashItemUnlocked> {
  return withLibraryLock(() => purgeTrashItemUnlocked(...args));
}

export function writeRawTextFile(...args: Parameters<typeof writeRawTextFileUnlocked>): ReturnType<typeof writeRawTextFileUnlocked> {
  return withLibraryLock(() => writeRawTextFileUnlocked(...args));
}

export function writeRawBase64File(...args: Parameters<typeof writeRawBase64FileUnlocked>): ReturnType<typeof writeRawBase64FileUnlocked> {
  return withLibraryLock(() => writeRawBase64FileUnlocked(...args));
}

export function writeCssIndex(...args: Parameters<typeof writeCssIndexUnlocked>): ReturnType<typeof writeCssIndexUnlocked> {
  return withLibraryLock(() => writeCssIndexUnlocked(...args));
}

export function writeJsIndex(...args: Parameters<typeof writeJsIndexUnlocked>): ReturnType<typeof writeJsIndexUnlocked> {
  return withLibraryLock(() => writeJsIndexUnlocked(...args));
}

/** Hidden learning metadata never enters the document index. Missing != unreadable. */
async function readLearningFileUnlocked(rel: string): Promise<LearningFile | null> {
  if (!isLearningPath(rel)) throw new Error("学习数据路径无效");
  try { return parseLearningFile(rel, await fs.readFile(absFromRel(rel), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export function readLearningFile(rel: string): Promise<LearningFile | null> {
  return withLibraryLock(() => readLearningFileUnlocked(rel));
}
export function writeLearningFile(rel: string, value: LearningFile): Promise<void> {
  return withLibraryLock(async () => {
    const raw = JSON.stringify(value, null, 2) + "\n";
    parseLearningFile(rel, raw);
    // Preserve unreadable bytes in place. A retry must never turn corruption into [].
    await readLearningFileUnlocked(rel);
    await atomicWrite(absFromRel(rel), raw);
  });
}
