import JSZip from "jszip";
import type { Document } from "../types";
import { basename, titleOf } from "../utils";
import { escapeHtml } from "./escape";
import { EXPORT_CSS, wrapStandaloneHtml } from "./standalone";
import {
  renderMarkdownForExport,
  type ExportAssetReader,
} from "./renderMarkdown";

/** Zip 内的一级目录，避免解压后把文件撒一地。 */
export const SITE_ROOT = "langhuan-site";

/**
 * 媒体在导出物里的落点。
 *
 * 图片不能只改 `src` 不落文件：整库 zip 要能离线打开，就把用到的资源
 * 一起塞进 `assets/`，页面里写相对路径。这样 zip 解开即用，不依赖琅嬛。
 *
 * 注意「zip 里的文件名」和「HTML 里的 href」是两件事：前者保留中文
 * （解压出来就是可读的文件名），后者按 URL 规则百分号编码。
 */
export function safeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\./g, "_");
}

export function encodeHref(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** 一篇文档在 zip 里的输出路径（`.md` → `.html`，HTML 原样，保留中文）。 */
export function htmlOutPath(doc: Document): string {
  const p = safeZipPath(doc.path);
  if (/\.html?$/i.test(p)) return p;
  return p.replace(/\.md$/i, "") + ".html";
}

/** 库里某篇文档被别处引用时，用的相对链接（已按 URL 规则编码）。 */
function relativeHref(fromOut: string, toOut: string): string {
  const fromDir = fromOut.split("/").slice(0, -1);
  const toParts = toOut.split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < toParts.length - 1 &&
    fromDir[common] === toParts[common]
  ) {
    common += 1;
  }
  const up = Array.from({ length: fromDir.length - common }, () => "..");
  return encodeHref([...up, ...toParts.slice(common)].join("/")) || encodeHref(basename(toOut));
}

function buildIndexHtml(docs: Document[], extraCss = ""): string {
  const sorted = [...docs].sort((a, b) => a.path.localeCompare(b.path, "zh"));
  const items = sorted
    .map(
      (d) =>
        `<li><a href="./${encodeHref(htmlOutPath(d))}">${escapeHtml(titleOf(d.path))}</a> <span class="muted">${escapeHtml(d.path)}</span></li>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>琅嬛 · 静态站点</title>
  <style>${EXPORT_CSS}
  ul.index { list-style: none; padding: 0; }
  ul.index li { padding: 0.45rem 0; border-bottom: 1px solid var(--border); }
  ul.index a { font-weight: 600; text-decoration: none; }
  ul.index a:hover { text-decoration: underline; }
  .muted { color: var(--muted); font-size: 0.8rem; margin-left: 0.5rem; font-family: ui-sans-serif, system-ui, sans-serif; }
  ${extraCss}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="meta">
      <h1>琅嬛 · 知识库</h1>
      <div class="path">共 ${docs.length} 篇 · 离线静态导出</div>
    </header>
    <ul class="index">
${items}
    </ul>
    <footer class="footer">由琅嬛导出 · ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（Asia/Shanghai）</footer>
  </div>
</body>
</html>`;
}

export type StaticSiteOptions = {
  documents: Document[];
  /** Prefer draft content when available */
  getContent?: (id: string) => string;
  /** 读库内二进制；给了才会把图片打进 zip。 */
  readAsset?: ExportAssetReader;
};

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "application/octet-stream": "bin",
};

function extForMedia(path: string, mime: string): string {
  const fromPath = /\.([a-z0-9]+)$/i.exec(path)?.[1];
  if (fromPath) return fromPath.toLowerCase();
  return MIME_EXT[mime] ?? "bin";
}

/**
 * Zip of HTML pages + index.html + assets/ for a whole-library static site.
 *
 * 离线可读的三个要点：
 *  1. 相对图片落进 `assets/`，页面里用相对路径（不是库里那条 `笔记/assets/x.png`）；
 *  2. 双链改成指向导出物里那篇 `.html` 的相对链接；
 *  3. 取不到的图片渲染成占位说明，不留碎图。
 */
export async function buildStaticSiteZip(opts: StaticSiteOptions): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(SITE_ROOT)!;
  const docs = opts.documents;

  /** 库内路径 → zip 内路径；同一张图被多篇引用时只落一份。 */
  const written = new Map<string, string>();
  const readAsset = opts.readAsset;

  /** 每篇页面都要按自己的位置算相对链接，所以按 outPath 现造一个解析器。 */
  const makeAssetResolver = (fromOut: string) =>
    readAsset
      ? async (libraryPath: string): Promise<string | null> => {
          let zipPath = written.get(libraryPath);
          if (!zipPath) {
            const file = await readAsset(libraryPath);
            if (!file) return null;

            const ext = extForMedia(libraryPath, file.mime);
            const stem = (basename(libraryPath).replace(/\.[^.]+$/, "") || "asset")
              .replace(/[^\w\u4e00-\u9fff-]/g, "-")
              .slice(0, 60);
            // 用库路径的短哈希做前缀：同名不同目录的图不会互相覆盖。
            const fileName = `${shortHash(libraryPath)}-${stem}.${ext}`;
            zipPath = `assets/${fileName}`;
            root.file(zipPath, file.base64, { base64: true });
            written.set(libraryPath, zipPath);
          }
          // 页面在 zip 的哪一层都能用：按当前页面位置算相对路径。
          return relativeHref(fromOut, zipPath);
        }
      : undefined;

  // 页面自己算相对路径：先建 out 路径表，再逐篇渲染。
  const outByDocId = new Map<string, string>();
  for (const d of docs) outByDocId.set(d.id, htmlOutPath(d));

  for (const d of docs) {
    const outPath = outByDocId.get(d.id)!;
    const content = opts.getContent ? opts.getContent(d.id) : d.content;

    if (d.type === "html") {
      const raw = /<html[\s>]/i.test(content) ? content : wrapStandaloneHtml({
        title: titleOf(d.path),
        path: d.path,
        bodyHtml: content,
      });
      root.file(outPath, raw);
      continue;
    }

    const { title, bodyHtml } = await renderMarkdownForExport({
      content,
      docPath: d.path,
      docs,
      hrefForDoc: (target) => {
        const targetOut = outByDocId.get(target.id);
        if (!targetOut) return null;
        return relativeHref(outPath, targetOut);
      },
      resolveAsset: makeAssetResolver(outPath),
    });

    root.file(
      outPath,
      wrapStandaloneHtml({
        title: title === "未命名" ? titleOf(d.path) : title,
        path: d.path,
        bodyHtml,
      })
    );
  }

  root.file("index.html", buildIndexHtml(docs));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** 短短一段稳定哈希：只为给资源文件去重命名，不做安全用途。 */
function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}
