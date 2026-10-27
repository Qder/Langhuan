import { marked } from "marked";
import type { Document } from "../types";
import { parseFrontmatter } from "../tags";
import { titleOf, basename } from "../utils";

/** Shared print / standalone CSS — 纸·墨·朱砂 */
export const EXPORT_CSS = `
:root {
  --bg: #f5efe2;
  --fg: #2b261f;
  --muted: #7a7265;
  --accent: #b3382a;
  --border: rgba(43, 38, 31, 0.12);
  --code-bg: #1a1814;
  --code-fg: #ece4d2;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
  line-height: 1.75;
  font-size: 16px;
}
.wrap {
  max-width: 720px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
}
header.meta {
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.75rem;
  padding-bottom: 1rem;
}
header.meta h1 {
  font-size: 1.75rem;
  margin: 0 0 0.35rem;
  font-weight: 700;
}
header.meta .path {
  color: var(--muted);
  font-size: 0.8rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.prose h1, .prose h2, .prose h3, .prose h4 {
  font-weight: 700;
  line-height: 1.35;
  margin: 1.6em 0 0.6em;
}
.prose h1 { font-size: 1.6rem; }
.prose h2 { font-size: 1.35rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
.prose h3 { font-size: 1.15rem; }
.prose p { margin: 0.75em 0; }
.prose a { color: var(--accent); }
.prose code {
  font-family: ui-monospace, "Geist Mono", monospace;
  font-size: 0.9em;
  background: rgba(43,38,31,0.06);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.prose pre {
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 1rem 1.1rem;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 0.85rem;
}
.prose pre code { background: transparent; padding: 0; color: inherit; }
.prose blockquote {
  margin: 1em 0;
  padding: 0.25em 0 0.25em 1em;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}
.prose ul, .prose ol { padding-left: 1.4em; }
.prose img { max-width: 100%; height: auto; border-radius: 8px; }
.prose table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
.prose th, .prose td { border: 1px solid var(--border); padding: 0.4em 0.6em; }
.prose th { background: rgba(43,38,31,0.04); }
.footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.75rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
@media print {
  body { background: #fff; }
  .wrap { max-width: none; padding: 0; }
  .no-print { display: none !important; }
  a { color: inherit; text-decoration: none; }
}
`.trim();

marked.setOptions({ gfm: true, breaks: false });

export function mdBodyToHtml(content: string): { title: string; bodyHtml: string } {
  const { data, body } = parseFrontmatter(content);
  const title =
    (typeof data.title === "string" && data.title) ||
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    "未命名";
  const bodyHtml = marked.parse(body, { async: false }) as string;
  return { title, bodyHtml };
}

export function wrapStandaloneHtml(opts: {
  title: string;
  path: string;
  bodyHtml: string;
  extraHead?: string;
}): string {
  const { title, path, bodyHtml, extraHead = "" } = opts;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · 琅嬛</title>
  <style>${EXPORT_CSS}</style>
  ${extraHead}
</head>
<body>
  <div class="wrap">
    <header class="meta">
      <h1>${escapeHtml(title)}</h1>
      <div class="path">${escapeHtml(path)}</div>
    </header>
    <article class="prose">${bodyHtml}</article>
    <footer class="footer">由琅嬛导出 · ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（Asia/Shanghai）</footer>
  </div>
</body>
</html>
`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a self-contained HTML string for one document. */
export function documentToStandaloneHtml(doc: Document, content?: string): string {
  const raw = content ?? doc.content;
  if (doc.type === "html") {
    // If already a full document, return as-is; else wrap
    if (/<html[\s>]/i.test(raw)) return raw;
    const title = titleOf(doc.path);
    return wrapStandaloneHtml({
      title,
      path: doc.path,
      bodyHtml: raw,
    });
  }
  const { title, bodyHtml } = mdBodyToHtml(raw);
  return wrapStandaloneHtml({
    title: title === "未命名" ? titleOf(doc.path) : title,
    path: doc.path,
    bodyHtml,
  });
}

export function suggestExportFilename(doc: Document, kind: "html" | "md" | "source"): string {
  const base = basename(doc.path).replace(/\.(md|html)$/i, "");
  if (kind === "html") return `${base}.html`;
  if (kind === "md") return `${base}.md`;
  return basename(doc.path);
}

/** Open a print window for browser Print → PDF. */
export function openPrintWindow(html: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("弹窗被拦截，请允许弹窗后重试（或改用导出独立 HTML）");
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give styles a tick to apply
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* user can print manually */
    }
  }, 300);
}
