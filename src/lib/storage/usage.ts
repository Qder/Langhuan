"use client";

import type { AssetMeta, Document, TrashItem } from "../types";
import { STORAGE_CRIT_BYTES, STORAGE_WARN_BYTES } from "./constants";
import { estimateVersionsBytes as defaultEstimateVersionsBytes } from "./versions";

export type StorageUsageLevel = "ok" | "warn" | "crit";

export type StorageUsageCategoryId =
  | "library"
  | "attachments"
  | "learning"
  | "versions"
  | "importedProjects";

export type StorageUsageCategory = {
  id: StorageUsageCategoryId;
  label: string;
  bytes: number;
  /** false：这次没能量到，不计入 usedBytes，也不要把 0 当成真实占用。 */
  measured: boolean;
};

export type StorageUsage = {
  usedBytes: number;
  quotaBytes: number | null;
  versionsBytes: number;
  level: StorageUsageLevel;
  categories: StorageUsageCategory[];
};

export const STORAGE_CATEGORY_LABELS: Record<StorageUsageCategoryId, string> = {
  library: "笔记库（含回收站与未保存草稿）",
  attachments: "附件",
  learning: "学习数据（批注、专题、练习、搜索与进度）",
  versions: "版本历史",
  importedProjects: "导入的读码项目",
};

export type StorageUsageExtras = {
  assets?: AssetMeta[];
  annotations?: unknown;
  savedSearches?: unknown;
  quizDocs?: unknown;
  learningTopics?: unknown;
  readingProgress?: unknown;
};

export type MeasuredBytes = { bytes: number; measured: boolean };

export type StorageUsageCollectors = {
  estimateVersionsBytes?: (docIds: string[]) => Promise<number>;
  estimateAttachmentBytes?: (assets: AssetMeta[] | undefined) => Promise<MeasuredBytes>;
  estimateSandboxBytes?: () => Promise<MeasuredBytes>;
};

export function measureJsonBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}

export function measureLibraryBytes(
  documents: Document[],
  drafts: Record<string, string>,
  trash: TrashItem[]
): number {
  try {
    return new Blob([
      JSON.stringify({ documents, drafts, trash }),
    ]).size;
  } catch {
    let n = 0;
    for (const d of documents) n += (d.content?.length || 0) * 2;
    for (const v of Object.values(drafts)) n += (v?.length || 0) * 2;
    for (const t of trash) n += (t.doc.content?.length || 0) * 2;
    return n;
  }
}

export function measureLearningBytes(parts: StorageUsageExtras): MeasuredBytes {
  const keys = [
    "annotations",
    "savedSearches",
    "quizDocs",
    "learningTopics",
    "readingProgress",
  ] as const;
  if (!keys.some((k) => parts[k] !== undefined)) return { bytes: 0, measured: false };
  const data: Record<string, unknown> = {};
  for (const k of keys) if (parts[k] !== undefined) data[k] = parts[k];
  return { bytes: measureJsonBytes(data), measured: true };
}

/** 每个附件 id 只计一次：有 IndexedDB 字节用实测，否则用元数据 size。不把同一附件的磁盘副本再加一遍。 */
export function mergeAttachmentBytes(
  blobSizes: ReadonlyMap<string, number>,
  assets: AssetMeta[] | undefined
): number {
  const byId = new Map(blobSizes);
  if (assets) {
    for (const a of assets) {
      if (byId.has(a.id)) continue;
      if (typeof a.size === "number" && a.size >= 0) byId.set(a.id, a.size);
    }
  }
  let bytes = 0;
  for (const n of byId.values()) bytes += n;
  return bytes;
}

export async function defaultEstimateAttachmentBytes(
  assets: AssetMeta[] | undefined
): Promise<MeasuredBytes> {
  const blobSizes = new Map<string, number>();
  let listed = false;
  try {
    const { estimateAssetBlobSizes } = await import("../assets/store");
    const listedSizes = await estimateAssetBlobSizes();
    for (const [id, size] of listedSizes) blobSizes.set(id, size);
    listed = true;
  } catch {
    listed = false;
  }
  if (!listed && assets === undefined) return { bytes: 0, measured: false };
  return { bytes: mergeAttachmentBytes(blobSizes, assets), measured: true };
}

export async function defaultEstimateSandboxBytes(): Promise<MeasuredBytes> {
  try {
    const { estimateSandboxBytes } = await import("../ide/sandboxFs");
    return { bytes: await estimateSandboxBytes(), measured: true };
  } catch {
    return { bytes: 0, measured: false };
  }
}

function usageLevel(usedBytes: number, quotaBytes: number | null): StorageUsageLevel {
  let level: StorageUsageLevel = "ok";
  if (usedBytes >= STORAGE_CRIT_BYTES) level = "crit";
  else if (usedBytes >= STORAGE_WARN_BYTES) level = "warn";
  if (quotaBytes && usedBytes / quotaBytes > 0.8) level = "crit";
  else if (quotaBytes && usedBytes / quotaBytes > 0.5 && level === "ok") level = "warn";
  return level;
}

export async function computeStorageUsage(
  documents: Document[],
  drafts: Record<string, string>,
  trash: TrashItem[],
  extras: StorageUsageExtras = {},
  collectors: StorageUsageCollectors = {}
): Promise<StorageUsage> {
  const libraryBytes = measureLibraryBytes(documents, drafts, trash);
  const estimateVersions = collectors.estimateVersionsBytes ?? defaultEstimateVersionsBytes;
  let versionsBytes = 0;
  let versionsMeasured = true;
  try {
    versionsBytes = await estimateVersions([
      ...documents.map((d) => d.id),
      ...trash.map((t) => t.doc.id),
    ]);
  } catch {
    versionsMeasured = false;
    versionsBytes = 0;
  }

  const learning = measureLearningBytes(extras);
  const estimateAttachments =
    collectors.estimateAttachmentBytes ?? defaultEstimateAttachmentBytes;
  const estimateSandboxes =
    collectors.estimateSandboxBytes ?? defaultEstimateSandboxBytes;
  const attachments = await estimateAttachments(extras.assets);
  const imported = await estimateSandboxes();

  const categories: StorageUsageCategory[] = [
    { id: "library", label: STORAGE_CATEGORY_LABELS.library, bytes: libraryBytes, measured: true },
    { id: "attachments", label: STORAGE_CATEGORY_LABELS.attachments, bytes: attachments.bytes, measured: attachments.measured },
    { id: "learning", label: STORAGE_CATEGORY_LABELS.learning, bytes: learning.bytes, measured: learning.measured },
    { id: "versions", label: STORAGE_CATEGORY_LABELS.versions, bytes: versionsBytes, measured: versionsMeasured },
    { id: "importedProjects", label: STORAGE_CATEGORY_LABELS.importedProjects, bytes: imported.bytes, measured: imported.measured },
  ];

  const usedBytes = categories.reduce((n, c) => n + (c.measured ? c.bytes : 0), 0);

  let quotaBytes: number | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === "number") quotaBytes = est.quota;
    }
  } catch {
    /* ignore */
  }

  return {
    usedBytes,
    quotaBytes,
    versionsBytes: versionsMeasured ? versionsBytes : 0,
    level: usageLevel(usedBytes, quotaBytes),
    categories,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
