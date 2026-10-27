import JSZip from "jszip";
import type { Document } from "../types";
import { documentToStandaloneHtml, escapeHtml, EXPORT_CSS } from "./standalone";
import { titleOf } from "../utils";

function safeRel(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\./g, "_");
}

function htmlOutPath(doc: Document): string {
  const p = safeRel(doc.path);
  if (/\.html?$/i.test(p)) return p;
  return p.replace(/\.md$/i, "") + ".html";
}

function buildIndexHtml(docs: Document[]): string {
  const sorted = [...docs].sort((a, b) => a.path.localeCompare(b.path, "zh"));
  const items = sorted
    .map((d) => {
      const href = htmlOutPath(d);
      const title = titleOf(d.path);
      return `<li><a href="./${escapeHtml(href)}">${escapeHtml(title)}</a> <span class="muted">${escapeHtml(d.path)}</span></li>`;
    })
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
  </style>
</head>
<body>
  <div class="wrap">
    <header class="meta">
      <h1>琅嬛 · 知识库</h1>
      <div class="path">共 ${docs.length} 篇 · 静态导出</div>
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
};

/** Zip of HTML pages + index.html for whole-library static site. */
export async function buildStaticSiteZip(opts: StaticSiteOptions): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder("langhuan-site")!;
  root.file("index.html", buildIndexHtml(opts.documents));
  for (const d of opts.documents) {
    const content = opts.getContent ? opts.getContent(d.id) : d.content;
    const html = documentToStandaloneHtml(d, content);
    root.file(htmlOutPath(d), html);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
