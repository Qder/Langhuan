/**
 * 文件夹同步：决定哪些外部二进制附件该扫进附件库。
 *
 * 写出附件本来就是完整的；扫入只收图片 / 常见附件，且必须落在
 * 「笔记已引用」或合理目录范围内，并套用与笔记 zip / SAF 相同的
 * 忽略规则与大小上限。超限如实说明，不把 node_modules 或无关二进制吸进来。
 */
import { isImportableLibraryPath, mimeForImportableImage } from "../importable";
import { isAbsoluteUrl, resolveAgainstDocPath } from "../resolveLibraryPath";
import { FS_INDEX_DIR } from "./constants";
import { safeRelPath } from "./pathSanitize";

/** 与藏书阁笔记 zip、Android SAF 扫库相同的上限。 */
export const SYNC_ASSET_MAX_FILES = 2000;
export const SYNC_ASSET_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const SYNC_ASSET_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export const SYNC_IGNORED_NAMES = new Set([
  "__MACOSX",
  ".DS_Store",
  "Thumbs.db",
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  FS_INDEX_DIR,
]);

/** 常见图片（含 ico）。svg 在库里按文档走，不进附件。 */
export const SYNC_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;

/** 非图片的常见附件：只在引用或合理目录里才收。 */
export const SYNC_COMMON_ATTACHMENT_EXT_RE = /\.pdf$/i;

const SCOPE_DIR_RE = /(^|\/)(assets|figs|images|img|attachments|static|media)\//i;

const UNSAFE_ATTACHMENT_EXT_RE =
  /\.(exe|dll|so|dylib|apk|dmg|bat|cmd|com|scr|msi|sh|ps1|jar|wasm)$/i;

const MD_LINK_RE = /!?\[[^\]]*]\(\s*<?([^>\s)]+)[^)]*>?\s*\)/g;
const HTML_ATTR_RE = /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

export type AssetScanSkip = { path: string; reason: string };

export type DiskAssetCandidate = {
  path: string;
  size: number;
  mtime: number;
};

export type PlannedAssetIngest = {
  accepted: DiskAssetCandidate[];
  skipped: AssetScanSkip[];
  truncated: boolean;
};

export function shouldIgnoreSyncName(name: string): boolean {
  if (!name) return true;
  if (SYNC_IGNORED_NAMES.has(name)) return true;
  if (name.startsWith(".") && name !== ".gitignore") return true;
  return false;
}

export function isIgnoredSyncPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some((seg) => shouldIgnoreSyncName(seg));
}

export function isSyncImagePath(path: string): boolean {
  return SYNC_IMAGE_EXT_RE.test(path.replace(/\\/g, "/"));
}

export function isSyncCommonAttachmentPath(path: string): boolean {
  return SYNC_COMMON_ATTACHMENT_EXT_RE.test(path.replace(/\\/g, "/"));
}

export function isReasonableAssetDir(path: string): boolean {
  return SCOPE_DIR_RE.test(path.replace(/\\/g, "/"));
}

export function mimeForSyncAsset(path: string, fileMime?: string): string {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".ico")) {
    const mime = (fileMime || "").toLowerCase().split(";")[0].trim();
    if (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") return mime;
    return "image/x-icon";
  }
  return mimeForImportableImage(path, fileMime);
}

function isDocumentPath(path: string): boolean {
  return isImportableLibraryPath(path) || /\.(html?|txt)$/i.test(path);
}

/**
 * 从一篇笔记里抽出相对附件路径（Markdown / HTML 本地链接）。
 * 外链、锚点、data/blob、双链都不算。
 */
export function extractReferencedAssetPaths(
  docPath: string,
  content: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const href = String(raw || "").trim();
    if (!href || isAbsoluteUrl(href) || href.startsWith("file:")) return;
    const resolved = safeRelPath(resolveAgainstDocPath(docPath, href));
    if (!resolved || seen.has(resolved)) return;
    if (isDocumentPath(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  };

  const md = String(content ?? "");
  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(md))) add(m[1] || "");
  HTML_ATTR_RE.lastIndex = 0;
  while ((m = HTML_ATTR_RE.exec(md))) add(m[1] || m[2] || "");
  return out;
}

export function collectReferencedAssetPaths(
  docs: Array<{ path: string; content: string }>
): Set<string> {
  const set = new Set<string>();
  for (const doc of docs) {
    const path = safeRelPath(doc.path);
    if (!path) continue;
    for (const ref of extractReferencedAssetPaths(path, doc.content)) {
      set.add(ref);
    }
  }
  return set;
}

/**
 * 某条磁盘文件该不该作为附件候选（尚未套用大小上限）。
 * 文档类型、忽略路径、可执行文件一律拒绝。
 */
export function classifySyncAsset(
  path: string,
  referenced: ReadonlySet<string>
): { ingest: boolean; reason?: string } {
  const rel = safeRelPath(path);
  if (!rel) return { ingest: false, reason: "路径无效" };
  if (isIgnoredSyncPath(rel)) {
    return { ingest: false, reason: "忽略目录或文件规则" };
  }
  if (isDocumentPath(rel)) {
    return { ingest: false, reason: "按笔记文档处理，不进附件库" };
  }
  if (UNSAFE_ATTACHMENT_EXT_RE.test(rel)) {
    return { ingest: false, reason: "不支持的附件类型" };
  }
  if (isSyncImagePath(rel)) return { ingest: true };
  if (isSyncCommonAttachmentPath(rel)) {
    if (referenced.has(rel) || isReasonableAssetDir(rel)) return { ingest: true };
    return { ingest: false, reason: "未在笔记中引用，也不在 assets 等合理目录" };
  }
  if (referenced.has(rel)) {
    return { ingest: false, reason: "不支持的附件类型" };
  }
  return { ingest: false, reason: "不是图片或常见附件" };
}

/**
 * 从磁盘候选里挑出该扫入的附件，并套用数量 / 单文件 / 合计上限。
 * 候选应按路径排好再传入，结果稳定。
 */
export function planIngestibleDiskAssets(
  candidates: DiskAssetCandidate[],
  docs: Array<{ path: string; content: string }>
): PlannedAssetIngest {
  const referenced = collectReferencedAssetPaths(docs);
  const accepted: DiskAssetCandidate[] = [];
  const skipped: AssetScanSkip[] = [];
  let truncated = false;
  let totalBytes = 0;

  const ordered = [...candidates].sort((a, b) =>
    safeRelPath(a.path).localeCompare(safeRelPath(b.path), "zh")
  );

  for (const raw of ordered) {
    const path = safeRelPath(raw.path);
    if (!path) {
      skipped.push({ path: raw.path, reason: "路径无效" });
      continue;
    }
    const verdict = classifySyncAsset(path, referenced);
    if (!verdict.ingest) {
      // 大量「不是图片」的普通文件不要把报告撑爆；只留下可能被关心的说明。
      if (
        verdict.reason &&
        verdict.reason !== "不是图片或常见附件" &&
        verdict.reason !== "按笔记文档处理，不进附件库" &&
        verdict.reason !== "忽略目录或文件规则"
      ) {
        skipped.push({ path, reason: verdict.reason });
      } else if (isSyncCommonAttachmentPath(path) && verdict.reason) {
        skipped.push({ path, reason: verdict.reason });
      }
      continue;
    }
    if (raw.size > SYNC_ASSET_MAX_FILE_BYTES) {
      skipped.push({ path, reason: "单文件超过 8 MiB 上限" });
      continue;
    }
    if (accepted.length >= SYNC_ASSET_MAX_FILES) {
      truncated = true;
      skipped.push({ path, reason: "超过附件数量上限（2000）" });
      continue;
    }
    if (totalBytes + raw.size > SYNC_ASSET_MAX_TOTAL_BYTES) {
      truncated = true;
      skipped.push({ path, reason: "超过附件合计 64 MiB 上限" });
      continue;
    }
    accepted.push({ ...raw, path, size: raw.size, mtime: raw.mtime });
    totalBytes += raw.size;
  }

  return { accepted, skipped, truncated };
}

/** 把跳过原因收成可展示的短句，避免把超长名单塞进状态栏。 */
export function formatAssetSkipSummary(
  skipped: AssetScanSkip[],
  truncated: boolean,
  limit = 3
): string {
  if (!skipped.length && !truncated) return "";
  const parts: string[] = [];
  if (truncated) parts.push("扫描已截断");
  if (skipped.length) {
    const head = skipped
      .slice(0, limit)
      .map((s) => `${s.path}（${s.reason}）`)
      .join("；");
    const more = skipped.length > limit ? ` 等 ${skipped.length} 项` : "";
    parts.push(`跳过附件 ${skipped.length}：${head}${more}`);
  }
  return parts.join(" · ");
}
