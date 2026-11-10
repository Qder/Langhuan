"use client";

import JSZip from "jszip";
import type { AssetMeta, Document, TrashItem } from "../types";
import type { Annotation } from "../annotations";
import type { ReadingPrefs } from "../readingPrefs";
import type { QuizDoc } from "../quiz";
import { getTags } from "../tags";
import { getAssetBlob, base64ToBlob, blobToBase64 } from "../assets/store";
import {
  sha256Hex,
  verifyBackupPayload,
  type BackupIntegrityReport,
} from "./backupIntegrity";

export {
  formatBackupIntegritySummary,
  verifyBackupPayload,
  type BackupIntegrityReport,
} from "./backupIntegrity";

import { normalizeAnnotation } from "../annotations";
import type { DocVersion } from "../types";
import type { SavedSearch } from "../searchQuery";
import type { LearningTopic } from "../learningTopics";
import {
  LEARNING_PATHS,
  REQUIRED_LEARNING_PATHS,
  versionPath,
  parseLearningFile,
  type ProgressMap,
  type LearningFile,
} from "./learningData";
export const BACKUP_MANIFEST_VERSION = 3;
export type BackupManifest = {
  format: "langhuan-backup";
  version: number;
  exportedAt: number;
  app: string;
  documents: Array<Omit<Document, "content"> & { tags?: string[] }>;
  trash?: Array<{ doc: Omit<Document, "content">; deletedAt: number }>;
  assets?: AssetMeta[];
  annotations?: Annotation[];
  readingPrefs?: ReadingPrefs;
  quizDocs?: QuizDoc[];
  assetDigests?: Record<string, string>;
  /** v3: complete learning files and hashes for every note/asset/metadata entry. */
  learningFiles?: string[];
  entryDigests?: Record<string, string>;
};
export type BackupPayload = {
  documents: Document[];
  trash: TrashItem[];
  assets?: AssetMeta[];
  annotations?: Annotation[];
  readingPrefs?: ReadingPrefs;
  quizDocs?: QuizDoc[];
  versions?: Record<string, DocVersion[]>;
  savedSearches?: SavedSearch[];
  readingProgress?: ProgressMap;
  topics?: LearningTopic[];
  /** Detached bytes: parsing never inserts these into live IDB. */
  assetBinaries?: Record<string, string>;
};
export type BackupBuildResult = {
  blob: Blob;
  report: BackupIntegrityReport;
  missingAssetBlobs: string[];
};
export type BackupParseResult = {
  payload: BackupPayload;
  report: BackupIntegrityReport;
  legacy: boolean;
};
export function safeBackupPath(value: string): string {
  const p = value.replace(/\\/g, "/");
  if (
    !p ||
    p.startsWith("/") ||
    /^[A-Za-z]:/.test(p) ||
    p.split("/").some((v) => !v || v === "." || v === "..") ||
    p.includes("\0")
  )
    throw new Error(`不安全的备份路径：${value}`);
  return p;
}
export function backupLearningFiles(
  payload: BackupPayload,
): [string, LearningFile][] {
  return [
    [
      LEARNING_PATHS.annotations,
      {
        format: "langhuan-annotations",
        version: 1,
        annotations: payload.annotations ?? [],
      },
    ],
    [
      LEARNING_PATHS.quiz,
      {
        format: "langhuan-quiz",
        version: 1,
        updatedAt: Math.max(
          0,
          ...(payload.quizDocs ?? []).map((d) => d.updatedAt),
        ),
        docs: payload.quizDocs ?? [],
      },
    ],
    [
      LEARNING_PATHS.searches,
      {
        format: "langhuan-saved-searches",
        version: 1,
        searches: payload.savedSearches ?? [],
      },
    ],
    [
      LEARNING_PATHS.progress,
      {
        format: "langhuan-reading-progress",
        version: 1,
        progress: payload.readingProgress ?? {},
      },
    ],
    [
      LEARNING_PATHS.topics,
      {
        format: "langhuan-topics",
        version: 1,
        topics: payload.topics ?? [],
      },
    ],
    ...Object.entries(payload.versions ?? {}).map(
      ([docId, versions]) =>
        [
          versionPath(docId),
          { format: "langhuan-versions", version: 1, docId, versions },
        ] as [string, LearningFile],
    ),
  ];
}
export function assignBackupLearning(
  payload: BackupPayload,
  file: LearningFile,
): void {
  switch (file.format) {
    case "langhuan-annotations":
      payload.annotations = file.annotations;
      break;
    case "langhuan-quiz":
      payload.quizDocs = file.docs;
      break;
    case "langhuan-saved-searches":
      payload.savedSearches = file.searches;
      break;
    case "langhuan-reading-progress":
      payload.readingProgress = file.progress;
      break;
    case "langhuan-versions":
      (payload.versions ??= Object.create(null))[file.docId] = file.versions;
      break;
    case "langhuan-topics":
      payload.topics = file.topics;
      break;
  }
}
const documentMeta = (d: Document): Omit<Document, "content"> => ({
  id: d.id,
  path: d.path,
  type: d.type,
  starred: d.starred,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const encoder = new TextEncoder();
export async function buildLibraryZip(payload: BackupPayload): Promise<Blob> {
  return (await buildLibraryZipDetailed(payload)).blob;
}
export async function buildLibraryZipDetailed(
  payload: BackupPayload,
): Promise<BackupBuildResult> {
  const zip = new JSZip();
  const folder = zip.folder("langhuan-backup")!;
  const entryDigests: Record<string, string> = {};
  const assetDigests: Record<string, string> = {};
  const missingAssetBlobs: string[] = [];
  const used = new Set<string>();
  async function add(name: string, bytes: Uint8Array) {
    safeBackupPath(name);
    if (used.has(name.toLowerCase())) throw new Error(`备份路径重复：${name}`);
    used.add(name.toLowerCase());
    folder.file(name, bytes);
    entryDigests[name] = await sha256Hex(bytes);
  }
  for (const d of payload.documents)
    await add(`files/${safeBackupPath(d.path)}`, encoder.encode(d.content));
  for (const t of payload.trash)
    await add(
      `files/_trash/${encodeURIComponent(t.doc.id)}__${safeBackupPath(t.doc.path)}`,
      encoder.encode(t.doc.content),
    );
  for (const a of payload.assets ?? []) {
    const binary = payload.assetBinaries?.[a.id];
    const blob =
      binary === undefined
        ? await getAssetBlob(a.id)
        : base64ToBlob(binary, a.mime);
    if (!blob) {
      missingAssetBlobs.push(a.path);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await add(`files/${safeBackupPath(a.path)}`, bytes);
    assetDigests[a.id] = await sha256Hex(bytes);
  }
  const learningFiles: string[] = [];
  for (const [rel, value] of backupLearningFiles(payload)) {
    const raw = JSON.stringify(value, null, 2);
    parseLearningFile(rel, raw);
    const name = `learning/${rel.slice(".langhuan/".length)}`;
    learningFiles.push(name);
    await add(name, encoder.encode(raw));
  }
  const manifest: BackupManifest = {
    format: "langhuan-backup",
    version: 3,
    exportedAt: Date.now(),
    app: "琅嬛 Langhuan",
    documents: payload.documents.map((d) => ({
      ...documentMeta(d),
      tags: getTags(d),
    })),
    trash: payload.trash.map((t) => ({
      doc: documentMeta(t.doc),
      deletedAt: t.deletedAt,
    })),
    assets: payload.assets,
    annotations: payload.annotations,
    quizDocs: payload.quizDocs,
    readingPrefs: payload.readingPrefs,
    assetDigests,
    entryDigests,
    learningFiles,
  };
  folder.file("manifest.json", JSON.stringify(manifest, null, 2));
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  const report = verifyBackupPayload(payload);
  report.issues.push(
    ...missingAssetBlobs.map((path) => ({
      kind: "missing-asset-blob" as const,
      message: `缺少附件二进制：${path}`,
      path,
    })),
  );
  report.ok = report.issues.length === 0;
  report.assetsRestored =
    (payload.assets?.length ?? 0) - missingAssetBlobs.length;
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/zip" }),
    report,
    missingAssetBlobs,
  };
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function defaultBackupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `langhuan-backup-${stamp}.zip`;
}

export function backupHasBlockingIssues(
  report: BackupIntegrityReport,
): boolean {
  return report.issues.some(
    (i) =>
      !["empty-document", "orphan-annotation", "conflict"].includes(i.kind),
  );
}
/** Pure preview: never writes IDB, files, notes or preferences. */
export async function parseLibraryZipDetailed(
  file: Blob,
): Promise<BackupParseResult> {
  if (file.size > 512 * 1024 * 1024) throw new Error("ZIP 文件超过 512 MiB");
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), {
    checkCRC32: true,
  });
  const entries = Object.entries(zip.files).filter(([, e]) => !e.dir);
  if (entries.length > 20000) throw new Error("备份文件过多");
  for (const [name, e] of entries)
    safeBackupPath(
      (e as typeof e & { unsafeOriginalName?: string }).unsafeOriginalName ??
        name,
    );
  const manifestName = entries
    .map(([n]) => n)
    .find((n) => n === "manifest.json" || n.endsWith("/manifest.json"));
  const issues: BackupIntegrityReport["issues"] = [];
  let expanded = 0;
  const read = async (name: string) => {
    const entry = zip.file(name);
    if (!entry) return null;
    const bytes = await entry.async("uint8array");
    expanded += bytes.byteLength;
    if (expanded > 512 * 1024 * 1024)
      throw new Error("解压内容超过 512 MiB，已停止预览");
    return bytes;
  };
  const decode = (bytes: Uint8Array) =>
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const decodeDoc = (bytes: Uint8Array) =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const payload: BackupPayload = {
    documents: [],
    trash: [],
    assets: [],
    annotations: [],
    quizDocs: [],
    savedSearches: [],
    readingProgress: {},
    versions: Object.create(null),
    assetBinaries: Object.create(null),
  };
  if (!manifestName) {
    const commonRoot = entries.every(
      ([n]) =>
        n.includes("/") && n.split("/")[0] === entries[0][0].split("/")[0],
    );
    for (const [name] of entries) {
      const rel = safeBackupPath(
        commonRoot ? name.slice(name.indexOf("/") + 1) : name,
      );
      const bytes = await read(name);
      if (!bytes) continue;
      if (/\.(md|html?|txt)$/i.test(rel) && !rel.startsWith("_trash/"))
        payload.documents.push({
          id: `import_${crypto.randomUUID()}`,
          path: rel.replace(/\.txt$/i, ".md"),
          type: /\.(html?|svg)$/i.test(rel) ? "html" : "md",
          content: decodeDoc(bytes),
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      else if (/\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(rel)) {
        const id = `asset_${crypto.randomUUID()}`;
        payload.assets!.push({
          id,
          path: rel,
          mime: "application/octet-stream",
          size: bytes.length,
          createdAt: Date.now(),
        });
        payload.assetBinaries![id] = await blobToBase64(
          new Blob([bytes as BlobPart]),
        );
      }
    }
    if (!payload.documents.length && !payload.assets!.length)
      throw new Error("压缩包中没有可导入的 .md / .html / 图片文件");
    return { payload, report: verifyBackupPayload(payload), legacy: true };
  }
  const manifest = JSON.parse(
    decode((await read(manifestName))!),
  ) as BackupManifest;
  if (manifest.format !== "langhuan-backup")
    throw new Error("不是琅嬛备份包（manifest.format 不匹配）");
  if (![1, 2, 3].includes(manifest.version))
    throw new Error("备份版本不受支持");
  const root = manifestName.slice(
    0,
    manifestName.length - "manifest.json".length,
  );
  const seen = new Set<string>();
  const obtain = async (relative: string, alternatives: string[] = []) => {
    const name = [root + relative, relative, ...alternatives].find((n) =>
      zip.file(n),
    );
    if (!name) return null;
    const bytes = await read(name);
    if (!bytes) return null;
    const expected = manifest.entryDigests?.[relative];
    if (
      manifest.version === 3 &&
      (!expected || !/^[a-f0-9]{64}$/i.test(expected))
    )
      issues.push({
        kind: "corrupt-metadata",
        path: relative,
        message: `v3 条目缺少有效校验和：${relative}`,
      });
    if (expected && (await sha256Hex(bytes)) !== expected)
      issues.push({
        kind: "entry-digest-mismatch",
        path: relative,
        message: `校验和不匹配：${relative}`,
      });
    return bytes;
  };
  for (const meta of manifest.documents ?? []) {
    safeBackupPath(meta.path);
    const key = meta.path.toLowerCase();
    if (seen.has(key))
      issues.push({
        kind: "duplicate-path",
        path: meta.path,
        message: `重复路径：${meta.path}`,
      });
    seen.add(key);
    const legacy = meta.path.replace(/\.\./g, "_");
    const bytes = await obtain(`files/${meta.path}`, [
      meta.path,
      ...(manifest.version < 3
        ? [`${root}files/${legacy}`, `files/${legacy}`, legacy]
        : []),
    ]);
    if (!bytes) {
      issues.push({
        kind: "missing-document-file",
        path: meta.path,
        message: `缺少正文：${meta.path}`,
      });
      continue;
    }
    payload.documents.push({
      ...meta,
      type: meta.type ?? (/\.(html?|svg)$/i.test(meta.path) ? "html" : "md"),
      content: decodeDoc(bytes),
      starred: !!meta.starred,
      createdAt: meta.createdAt || 0,
      updatedAt: meta.updatedAt || 0,
    });
  }
  for (const t of manifest.trash ?? []) {
    safeBackupPath(t.doc.path);
    const legacyTrash = `files/_trash/${t.doc.id}__${t.doc.path}`.replace(
      /\.\./g,
      "_",
    );
    const bytes = await obtain(
      `files/_trash/${encodeURIComponent(t.doc.id)}__${t.doc.path}`,
      [`${root}${legacyTrash}`, legacyTrash],
    );
    if (!bytes) {
      issues.push({
        kind: "missing-document-file",
        path: t.doc.path,
        message: `缺少回收站正文：${t.doc.path}`,
      });
      continue;
    }
    payload.trash.push({
      deletedAt: t.deletedAt,
      doc: {
        ...t.doc,
        type:
          t.doc.type ?? (/\.(html?|svg)$/i.test(t.doc.path) ? "html" : "md"),
        starred: !!t.doc.starred,
        createdAt: t.doc.createdAt || 0,
        updatedAt: t.doc.updatedAt || 0,
        content: decodeDoc(bytes),
      },
    });
  }
  for (const a of manifest.assets ?? []) {
    safeBackupPath(a.path);
    const bytes = await obtain(
      `files/${a.path}`,
      manifest.version < 3
        ? [
            `${root}files/${a.path.replace(/\.\./g, "_")}`,
            `files/${a.path.replace(/\.\./g, "_")}`,
          ]
        : [],
    );
    if (!bytes) {
      issues.push({
        kind: "missing-asset-in-zip",
        path: a.path,
        message: `清单附件缺失：${a.path}`,
      });
      continue;
    }
    if (
      manifest.assetDigests?.[a.id] &&
      (await sha256Hex(bytes)) !== manifest.assetDigests[a.id]
    )
      issues.push({
        kind: "asset-digest-mismatch",
        id: a.id,
        message: `附件校验和不匹配：${a.path}`,
      });
    if (seen.has(a.path.toLowerCase()))
      issues.push({
        kind: "duplicate-path",
        path: a.path,
        message: `正文/附件路径冲突：${a.path}`,
      });
    seen.add(a.path.toLowerCase());
    payload.assets!.push({
      ...a,
      mime: a.mime || "application/octet-stream",
      createdAt: a.createdAt || 0,
      size: bytes.length,
    });
    payload.assetBinaries![a.id] = await blobToBase64(
      new Blob([bytes as BlobPart], { type: a.mime }),
    );
  }
  const oldAnnotations = manifest.annotations;
  const oldQuiz = manifest.quizDocs;
  payload.annotations = (oldAnnotations ?? []).map((a) =>
    normalizeAnnotation(a),
  );
  payload.quizDocs = normalizeOldQuiz(oldQuiz ?? []);
  payload.readingPrefs = manifest.readingPrefs;
  if (manifest.version < 3) {
    for (const [name, kind] of [
      ["annotations.json", "ann"],
      ["quiz.json", "quiz"],
    ] as const) {
      const bytes = await obtain(name);
      if (!bytes) continue;
      try {
        const value = JSON.parse(decode(bytes));
        if (kind === "ann")
          payload.annotations = (
            Array.isArray(value) ? value : value.annotations
          ).map(normalizeAnnotation);
        else
          payload.quizDocs = normalizeOldQuiz(
            Array.isArray(value) ? value : value.docs,
          );
      } catch {
        issues.push({
          kind: "corrupt-metadata",
          path: name,
          message: `旧元数据损坏：${name}`,
        });
      }
    }
  }
  for (const name of manifest.learningFiles ?? []) {
    safeBackupPath(name);
    if (!name.startsWith("learning/")) throw new Error("学习文件路径无效");
    const bytes = await obtain(name);
    if (!bytes) {
      issues.push({
        kind: "corrupt-metadata",
        path: name,
        message: `缺少学习文件：${name}`,
      });
      continue;
    }
    try {
      assignBackupLearning(
        payload,
        parseLearningFile(`.langhuan/${name.slice(9)}`, decode(bytes)),
      );
    } catch (e) {
      issues.push({
        kind: "corrupt-metadata",
        path: name,
        message: `学习文件损坏：${name}（${String(e)}）`,
      });
    }
  }
  if (manifest.version === 3)
    for (const rel of Object.values(REQUIRED_LEARNING_PATHS))
      if (!manifest.learningFiles?.includes(`learning/${rel.slice(10)}`))
        issues.push({
          kind: "corrupt-metadata",
          path: rel,
          message: `v3 清单缺少 ${rel}`,
        });
  for (const [rel, value] of backupLearningFiles(payload)) {
    try {
      parseLearningFile(rel, JSON.stringify(value));
    } catch (e) {
      issues.push({
        kind: "corrupt-metadata",
        path: rel,
        message: `学习数据格式损坏：${rel}（${String(e)}）`,
      });
    }
  }
  const report = verifyBackupPayload(payload);
  report.issues.push(...issues);
  report.ok = report.issues.length === 0;
  report.assetsListed = manifest.assets?.length ?? 0;
  report.assetsRestored = payload.assets!.length;
  return { payload, report, legacy: manifest.version < 3 };
}
function normalizeOldQuiz(docs: QuizDoc[]): QuizDoc[] {
  return (docs ?? []).map((d) => ({
    ...d,
    updatedAt: d.updatedAt ?? 0,
    items: (d.items ?? []).map((i) => ({ ...i, updatedAt: i.updatedAt ?? 0 })),
  }));
}
export async function parseLibraryZip(file: Blob): Promise<BackupPayload> {
  return (await parseLibraryZipDetailed(file)).payload;
}
export { blobToBase64, base64ToBlob };
