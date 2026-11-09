/**
 * Backup integrity for notes + images + annotations.
 * Digests are sha-256 hex; never log secrets (none in vault blobs).
 */

import type { AssetMeta, Document } from "../types";
import type { Annotation } from "../annotations";
import type { BackupPayload } from "./backup";

export type BackupIntegrityIssue = {
  kind:
    | "missing-asset-blob"
    | "missing-asset-in-zip"
    | "asset-digest-mismatch"
    | "empty-document"
    | "missing-document-file"
    | "orphan-annotation"
    | "count-mismatch";
  message: string;
  id?: string;
  path?: string;
};

export type BackupIntegrityReport = {
  ok: boolean;
  documents: number;
  assetsListed: number;
  assetsRestored: number;
  annotations: number;
  issues: BackupIntegrityIssue[];
};

/**
 * SHA-256 hex digest (notes/images/annotations integrity).
 *
 * Node 20 + vitest/jsdom: `crypto.subtle.digest` rejects **cross-realm ArrayBuffers**
 * (e.g. `jsdomUint8Array.buffer`) with ERR_INVALID_ARG_TYPE — exact CI failure.
 * TypedArray views can work, but `createHash('sha256')` is the reliable Node path.
 * Browser: SubtleCrypto with a copied Uint8Array view (never pass `.buffer` alone).
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  const bytes = await bytesForDigest(data);

  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const { createHash } = await import("node:crypto");
      return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    } catch {
      try {
        const { createHash } = await import("crypto");
        return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
      } catch {
        /* fall through to SubtleCrypto */
      }
    }
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 不可用（无 SubtleCrypto / node crypto）");
  }
  // Pass ArrayBufferView — do NOT pass bytes.buffer (cross-realm AB fails on Node 20).
  const hash = await subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Own copy so subarray / Buffer-pool offsets cannot leak into the digest. */
async function bytesForDigest(
  data: ArrayBuffer | Uint8Array | Blob
): Promise<Uint8Array> {
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy;
  }
  return new Uint8Array(data);
}

export function emptyIntegrityReport(): BackupIntegrityReport {
  return {
    ok: true,
    documents: 0,
    assetsListed: 0,
    assetsRestored: 0,
    annotations: 0,
    issues: [],
  };
}

/** Logical verify after parse / before import: counts + orphan annotations + empty docs. */
export function verifyBackupPayload(payload: BackupPayload): BackupIntegrityReport {
  const issues: BackupIntegrityIssue[] = [];
  const docs = payload.documents || [];
  const assets = payload.assets || [];
  const anns = payload.annotations || [];
  const docIds = new Set(docs.map((d) => d.id));

  for (const d of docs) {
    if (!String(d.content ?? "").trim()) {
      issues.push({
        kind: "empty-document",
        message: `笔记「${d.path}」正文为空（zip 里可能缺文件）`,
        id: d.id,
        path: d.path,
      });
    }
  }

  for (const a of anns) {
    if (!docIds.has(a.docId)) {
      issues.push({
        kind: "orphan-annotation",
        message: `批注 ${a.id.slice(0, 8)}… 指向不存在的文档`,
        id: a.id,
        path: a.path,
      });
    }
  }

  const report: BackupIntegrityReport = {
    ok: issues.length === 0,
    documents: docs.length,
    assetsListed: (payload.assets && payload.assets.length) || assets.length,
    assetsRestored: assets.length,
    annotations: anns.length,
    issues,
  };
  return report;
}

export function mergeIntegrityReports(
  ...parts: BackupIntegrityReport[]
): BackupIntegrityReport {
  const issues = parts.flatMap((p) => p.issues);
  return {
    ok: issues.length === 0,
    documents: Math.max(...parts.map((p) => p.documents), 0),
    assetsListed: Math.max(...parts.map((p) => p.assetsListed), 0),
    assetsRestored: Math.max(...parts.map((p) => p.assetsRestored), 0),
    annotations: Math.max(...parts.map((p) => p.annotations), 0),
    issues,
  };
}

export function formatBackupIntegritySummary(report: BackupIntegrityReport): string {
  const base = `校验：笔记 ${report.documents} · 图片 ${report.assetsRestored}/${report.assetsListed} · 批注 ${report.annotations}`;
  if (report.ok) return `${base} · 完整`;
  const head = report.issues.slice(0, 3).map((i) => i.message);
  const more =
    report.issues.length > 3 ? `等 ${report.issues.length} 项` : head.join("；");
  return `${base} · 有问题：${report.issues.length > 3 ? head.join("；") + "；" + more : head.join("；")}`;
}

/** Assets listed in meta but not restored from zip. */
export function reportMissingAssets(
  listed: AssetMeta[],
  restoredIds: Set<string>
): BackupIntegrityIssue[] {
  const issues: BackupIntegrityIssue[] = [];
  for (const a of listed) {
    if (!restoredIds.has(a.id)) {
      issues.push({
        kind: "missing-asset-in-zip",
        message: `图片「${a.path}」在清单中但 zip 内无文件`,
        id: a.id,
        path: a.path,
      });
    }
  }
  return issues;
}

export function reportDigestMismatches(
  expected: Record<string, string>,
  actual: Record<string, string>
): BackupIntegrityIssue[] {
  const issues: BackupIntegrityIssue[] = [];
  for (const [id, want] of Object.entries(expected)) {
    const got = actual[id];
    if (!got) continue;
    if (got !== want) {
      issues.push({
        kind: "asset-digest-mismatch",
        message: `图片 ${id.slice(0, 8)}… 校验和不匹配`,
        id,
      });
    }
  }
  return issues;
}

export type { Document, Annotation, AssetMeta };
