/**
 * Local library image upload helpers (no third-party hosting).
 * Preview context menu / source CM6 / touch menus share these.
 */

import { IMPORTABLE_IMAGE_EXT_RE } from "../importable";
import {
  findGapInsertAt,
  normalizeAppendWriteText,
  prepareAppendAtEnd,
  prepareInsertBetween,
  replaceRange,
} from "../mdInlineEdit";
import { extFromMime, mimeFromExt } from "./paths";

/** Align with library zip / project per-file caps. */
export const MAX_LIBRARY_IMAGE_BYTES = 8 * 1024 * 1024;

export const LIBRARY_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif";

export function formatLibraryImageBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type ImageFileValidation =
  | { ok: true; mime: string }
  | { ok: false; message: string };

/**
 * Type + size gate for library image ingest.
 * Empty MIME is common on Android pickers — fall back to extension.
 */
export function validateLibraryImageFile(file: {
  type?: string;
  name?: string;
  size: number;
}): ImageFileValidation {
  const rawMime = (file.type || "").toLowerCase().split(";")[0].trim();
  const name = file.name || "";
  const byExt = IMPORTABLE_IMAGE_EXT_RE.test(name);
  const byMime =
    rawMime.startsWith("image/") &&
    rawMime !== "image/svg+xml" &&
    rawMime !== "image/x-icon";

  if (!byMime && !byExt) {
    return {
      ok: false,
      message: "仅支持图片（PNG / JPEG / GIF / WebP / BMP / AVIF）",
    };
  }
  if (file.size <= 0) {
    return { ok: false, message: "图片文件为空" };
  }
  if (file.size > MAX_LIBRARY_IMAGE_BYTES) {
    return {
      ok: false,
      message: `图片过大（${formatLibraryImageBytes(file.size)}，上限 ${formatLibraryImageBytes(MAX_LIBRARY_IMAGE_BYTES)}）`,
    };
  }

  let mime = byMime ? rawMime : "";
  if (!mime) {
    const m = name.replace(/\\/g, "/").toLowerCase().match(/\.([a-z0-9]+)$/);
    mime = mimeFromExt(m?.[1] || "png");
  }
  if (mime === "application/octet-stream") mime = "image/png";
  return { ok: true, mime };
}

/** Open a one-shot file picker. Cancel → null (no mutation). */
export function pickLibraryImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = LIBRARY_IMAGE_ACCEPT;
    input.setAttribute("aria-hidden", "true");
    input.tabIndex = -1;
    input.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;";

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      try {
        input.remove();
      } catch {
        /* ignore */
      }
      resolve(file);
    };

    input.addEventListener("change", () => {
      finish(input.files?.[0] ?? null);
    });
    // Chromium: cancel event when the dialog is dismissed with no file.
    input.addEventListener("cancel", () => finish(null));

    document.body.appendChild(input);
    input.click();

    // Fallback for browsers that fire neither change nor cancel on dismiss.
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish(input.files?.[0] ?? null);
      }, 400);
    };
    window.addEventListener("focus", onFocus, { once: true });
  });
}

/**
 * Resolve a source offset for preview right-click insertion.
 * Prefer gap between blocks; else after (or before) the clicked block; else EOF.
 */
export function resolvePreviewImageInsertAt(opts: {
  root: ParentNode | null;
  clientY: number;
  srcStart?: number;
  srcEnd?: number;
  sourceLength: number;
}): number {
  const len = Math.max(0, opts.sourceLength);
  if (opts.root) {
    const gap = findGapInsertAt(opts.root, opts.clientY);
    if (gap) return clampOffset(gap.insertAt, len);
  }
  const start = opts.srcStart;
  const end = opts.srcEnd;
  if (typeof start === "number" && Number.isFinite(start)) {
    const hasEnd = typeof end === "number" && Number.isFinite(end);
    if (hasEnd && opts.root) {
      // Top half of the clicked block → insert before; else after.
      try {
        const el = [
          ...(opts.root as ParentNode).querySelectorAll<HTMLElement>(
            "[data-src-start]"
          ),
        ].find((n) => Number(n.getAttribute("data-src-start")) === start);
        if (el) {
          const r = el.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          if (opts.clientY < mid) return clampOffset(start, len);
        }
      } catch {
        /* ignore geometry */
      }
      return clampOffset(end as number, len);
    }
    // No DOM geometry: prefer end (after the clicked block), else start.
    if (hasEnd) return clampOffset(end as number, len);
    return clampOffset(start, len);
  }
  return len;
}

function clampOffset(n: number, len: number): number {
  return Math.max(0, Math.min(Math.floor(n), len));
}

/**
 * Insert a markdown image snippet as its own paragraph at `insertAt`
 * (preview / block-style mid-document insert).
 */
export function insertImageMarkdownAt(
  source: string,
  insertAt: number,
  snippet: string
): string {
  const write = normalizeAppendWriteText(snippet.trimEnd());
  if (!write) return source;
  const at = clampOffset(insertAt, source.length);
  if (at >= source.length) {
    const { prepared, start, end } = prepareAppendAtEnd(source);
    return replaceRange(prepared, start, end, write);
  }
  const { prepared, start, end } = prepareInsertBetween(source, at);
  return replaceRange(prepared, start, end, write);
}

/** Caret-style splice for source CM6 (no extra blank-line prep). */
export function insertImageMarkdownInline(
  source: string,
  insertAt: number,
  snippet: string
): string {
  const at = clampOffset(insertAt, source.length);
  return source.slice(0, at) + snippet + source.slice(at);
}

/** Filename stem used when File.type is empty — keep ingest naming stable. */
export function suggestedImageFilename(
  file: { name?: string; type?: string },
  mime: string
): string {
  const name = (file.name || "").trim();
  if (name) return name;
  return `image.${extFromMime(mime)}`;
}
