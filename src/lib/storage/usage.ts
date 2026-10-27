"use client";

import type { Document, TrashItem } from "../types";
import { STORAGE_CRIT_BYTES, STORAGE_WARN_BYTES } from "./constants";
import { estimateVersionsBytes } from "./versions";

export type StorageUsage = {
  usedBytes: number;
  quotaBytes: number | null;
  versionsBytes: number;
  level: "ok" | "warn" | "crit";
};

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

export async function computeStorageUsage(
  documents: Document[],
  drafts: Record<string, string>,
  trash: TrashItem[]
): Promise<StorageUsage> {
  const libraryBytes = measureLibraryBytes(documents, drafts, trash);
  const versionsBytes = await estimateVersionsBytes([
    ...documents.map((d) => d.id),
    ...trash.map((t) => t.doc.id),
  ]);
  const usedBytes = libraryBytes + versionsBytes;

  let quotaBytes: number | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === "number") quotaBytes = est.quota;
    }
  } catch {
    /* ignore */
  }

  let level: StorageUsage["level"] = "ok";
  if (usedBytes >= STORAGE_CRIT_BYTES) level = "crit";
  else if (usedBytes >= STORAGE_WARN_BYTES) level = "warn";
  if (quotaBytes && usedBytes / quotaBytes > 0.8) level = "crit";
  else if (quotaBytes && usedBytes / quotaBytes > 0.5 && level === "ok") level = "warn";

  return { usedBytes, quotaBytes, versionsBytes, level };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
