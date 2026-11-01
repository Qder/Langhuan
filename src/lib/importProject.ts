/**
 * 项目导入规划（纯函数，不碰磁盘 / 状态）。
 *
 * 目标：把一个 `index.html + css/ + js/` 的文件夹当成一个整体导入——保留完整目录结构，
 * 只有「正文类型」的文件变成文档（可编辑、进索引），其余（css/js/图片…）原样落盘当项目
 * 资源，由预览时内联（见 inlineProject.ts）。
 */

import { dirname } from "./utils";
import { collectExternalRefs } from "./inlineProject";
import { normalizeProjectRel, type ProjectMeta } from "./project";

/** 整目录跳过的名字（大小写敏感，与文件系统一致）。 */
export const PROJECT_IGNORED_SEGMENTS = new Set([
  "node_modules",
  "__MACOSX",
  "Thumbs.db",
  "desktop.ini",
  ".DS_Store",
]);

/** 单个项目文件上限；超过就跳过（避免把一个 200MB 的 dist 拖进来）。 */
export const MAX_PROJECT_FILE_BYTES = 8 * 1024 * 1024;

/** 编译成文档的扩展名（.txt 不在此列：扫描时会被规范成 .md，会撑破项目结构）。 */
const PROJECT_DOC_RE = /\.(md|html|svg)$/i;

/** 当文本处理 / 内联的扩展名。 */
const PROJECT_TEXT_RE =
  /\.(md|html|css|js|mjs|cjs|json|txt|svg|xml|map|ya?ml|toml|ini|csv)$/i;

export function isProjectDocPath(path: string): boolean {
  return PROJECT_DOC_RE.test(path.replace(/\\/g, "/"));
}

export function isProjectTextPath(path: string): boolean {
  return PROJECT_TEXT_RE.test(path.replace(/\\/g, "/"));
}

/** 路径是否有需要跳过的段（点开头目录、node_modules、.DS_Store 等）。 */
export function isIgnoredProjectPath(path: string): boolean {
  const segs = normalizeProjectRel(path).split("/").filter(Boolean);
  return segs.some((s) => s.startsWith(".") || PROJECT_IGNORED_SEGMENTS.has(s));
}

/**
 * 识别入口：优先根目录 index.html；否则要求全项目只有唯一一个 .html。
 * 多于一个且没有 index 时返回 null（不替用户猜）。
 */
export function detectProjectEntry(paths: string[]): string | null {
  const htmls = paths
    .map((p) => normalizeProjectRel(p))
    .filter((p) => p && !isIgnoredProjectPath(p) && /\.html$/i.test(p));
  if (!htmls.length) return null;
  const rootIndex = htmls.find((p) => !p.includes("/") && /^index\.html$/i.test(p));
  if (rootIndex) return rootIndex;
  if (htmls.length === 1) return htmls[0];
  return null;
}

export type ProjectPickedFile = {
  /** 相对选中文件夹根目录的路径（可含子目录） */
  path: string;
  text?: string;
  base64?: string;
};

export type ProjectPlanOk = {
  ok: true;
  /** 库内项目根目录（已去重），如 "demo-site" */
  root: string;
  meta: ProjectMeta;
  /** 变成文档的文件（库内路径 + 内容） */
  docs: { path: string; content: string }[];
  /** 原样落盘的文本资源（css/js/json…） */
  rawText: { path: string; content: string }[];
  /** 原样落盘的二进制资源（图片…，base64） */
  rawBinary: { path: string; base64: string }[];
  /** 被忽略或超限的文件（项目内相对路径） */
  skipped: string[];
};

export type ProjectPlanErr = {
  ok: false;
  reason: string;
};

export type ProjectPlan = ProjectPlanOk | ProjectPlanErr;

/** 选中的文件夹名 → 合法的项目根目录名。 */
export function sanitizeProjectName(name: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() || "";
  const safe = cleaned
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
  return safe || "项目";
}

/** 根目录去重：与库内已有路径比对（`demo-site` 已存在则 `demo-site-2`）。 */
export function uniqueProjectRoot(name: string, existingPaths: string[]): string {
  const base = sanitizeProjectName(name);
  const taken = new Set<string>();
  for (const p of existingPaths) {
    const n = normalizeProjectRel(p);
    if (!n) continue;
    taken.add(n.split("/")[0]);
  }
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const next = `${base}-${i}`;
    if (!taken.has(next)) return next;
  }
  return `${base}-${Date.now()}`;
}

/** UTF-8 字节数（浏览器 / Node 都有 TextEncoder，不依赖 Buffer）。 */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 规划一次项目导入。`existingPaths` 是库内已有文件 / 文件夹路径，用于项目根去重。
 */
export function planProjectImport(input: {
  name: string;
  files: ProjectPickedFile[];
  existingPaths?: string[];
  now?: Date;
}): ProjectPlan {
  const kept: { rel: string; file: ProjectPickedFile }[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const file of input.files) {
    const rel = normalizeProjectRel(file.path);
    if (!rel) continue;
    if (isIgnoredProjectPath(rel)) {
      skipped.push(rel);
      continue;
    }
    if (seen.has(rel)) continue;
    const content = file.text ?? "";
    const size = file.base64
      ? Math.floor((file.base64.length * 3) / 4)
      : utf8Bytes(content);
    if (size > MAX_PROJECT_FILE_BYTES) {      skipped.push(rel);
      continue;
    }
    seen.add(rel);
    kept.push({ rel, file });
  }

  if (!kept.length) return { ok: false, reason: "文件夹是空的（或全被忽略）" };

  const entry = detectProjectEntry(kept.map((k) => k.rel));
  if (!entry) {
    const htmls = kept.filter((k) => /\.html$/i.test(k.rel));
    return {
      ok: false,
      reason: htmls.length
        ? "找到多个 .html 但没有根目录 index.html，无法确定入口"
        : "没有找到 HTML 文件，不像一个可预览的项目",
    };
  }

  const root = uniqueProjectRoot(input.name, input.existingPaths || []);
  const entryFile = kept.find((k) => k.rel === entry);
  const baseDir = dirname(entry);
  const external = collectExternalRefs(entryFile?.file.text ?? "", { baseDir });

  const docs: ProjectPlanOk["docs"] = [];
  const rawText: ProjectPlanOk["rawText"] = [];
  const rawBinary: ProjectPlanOk["rawBinary"] = [];

  for (const { rel, file } of kept) {
    const path = `${root}/${rel}`;
    if (isProjectDocPath(rel)) {
      docs.push({ path, content: file.text ?? "" });
    } else if (file.base64) {
      rawBinary.push({ path, base64: file.base64 });
    } else if (isProjectTextPath(rel) || typeof file.text === "string") {
      rawText.push({ path, content: file.text ?? "" });
    } else {
      skipped.push(rel);
    }
  }

  const importedAt = (input.now || new Date()).toISOString();
  const meta: ProjectMeta = {
    root,
    entry,
    files: kept.map((k) => k.rel).sort((a, b) => a.localeCompare(b, "zh")),
    external,
    importedAt,
  };

  return { ok: true, root, meta, docs, rawText, rawBinary, skipped };
}
