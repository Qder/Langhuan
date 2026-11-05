import type { Document } from "../types";
import { titleOf } from "../utils";
import { escapeHtml } from "./escape";
import { renderMarkdownForExport, type ExportAssetReader } from "./renderMarkdown";

export { escapeHtml };

/**
 * Shared print / standalone CSS — 纸·墨·朱砂
 *
 * 导出是「一张纸」，只有浅纸形态：不跟应用里的九套主题联动。
 * 这里额外带上了 callout 卡片、行内代码、图片占位与双链胶囊的样式，
 * 因为导出物要能在没有琅嬛的机器上离线打开，样式必须自带。
 */
export const EXPORT_CSS = `
:root {
  --bg: #f5efe2;
  --fg: #2b261f;
  --muted: #7a7265;
  --accent: #b3382a;
  --border: rgba(43, 38, 31, 0.12);
  /* 导出是单页纸面，只有一个「浅纸」形态：代码块跟预览的浅色主题对齐（浅底深字），
     不要再做深色终端砖。五套主题的切换只发生在应用里。 */
  --code-bg: #efe7d6;
  --code-fg: #2b261f;
  --code-border: rgba(43, 38, 31, 0.16);
  /* callout 三色相：与预览的 tip/note/warn 对应 */
  --callout-tip: #3d6b7a;
  --callout-note: #a87a2c;
  --callout-warn: #b3382a;
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
  border: 1px solid var(--code-border);
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
.prose img {
  display: block;
  max-width: 100%;
  max-height: 720px;
  height: auto;
  object-fit: contain;
  margin: 1.2em auto;
  border-radius: 8px;
}
.prose figure { margin: 1.4em 0; text-align: center; }
.prose figcaption {
  margin-top: 0.5em;
  color: var(--muted);
  font-size: 0.8rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.prose table { border-collapse: collapse; width: 100%; max-width: 100%; margin: 1em 0; font-size: 0.95em; }
.prose th, .prose td { border: 1px solid var(--border); padding: 0.4em 0.6em; }
.prose th { background: rgba(43,38,31,0.04); }

/* ---- callout 卡片（rehypeCallout 的输出）---- */
.prose .callout {
  --callout-hue: var(--callout-note);
  margin: 1.2em 0;
  padding: 0.85em 1em;
  border-left: 3px solid var(--callout-hue);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--callout-hue) 8%, transparent);
}
.prose .callout.tip { --callout-hue: var(--callout-tip); }
.prose .callout.note { --callout-hue: var(--callout-note); }
.prose .callout.warn,
.prose .callout.warning,
.prose .callout.important,
.prose .callout.caution { --callout-hue: var(--callout-warn); }
.prose .callout-title {
  font-weight: 700;
  font-size: 0.95em;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--callout-hue) 78%, var(--fg));
  margin-bottom: 0.35em;
}
.prose .callout-body > :first-child { margin-top: 0; }
.prose .callout-body > :last-child { margin-bottom: 0; }
.prose .callout-body blockquote { color: var(--muted); }

/* ---- 代码高亮：与预览同一批 --syn-* 语义色（这里给浅纸一套）---- */
.hljs { color: var(--code-fg); }
.hljs-comment, .hljs-quote { color: #8a8071; font-style: normal; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #a8434a; }
.hljs-title, .hljs-title.function_, .hljs-title.class_ { color: #6b4a8a; }
.hljs-attr, .hljs-attribute, .hljs-number, .hljs-operator, .hljs-variable { color: #2f5d7a; }
.hljs-string, .hljs-regexp { color: #4a6b3a; }
.hljs-built_in, .hljs-symbol { color: #8a5a1e; }
.hljs-name, .hljs-selector-id, .hljs-selector-class { color: #2f6b4f; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }

/* ---- 双链胶囊：离线时目标不可达就不可点，别做成死链 ---- */
.export-wiki {
  display: inline;
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--accent);
  text-decoration: none;
}
a.export-wiki:hover { border-bottom-color: var(--accent); }
.export-wiki-missing,
.export-wiki-outside,
.export-wiki-embed {
  color: var(--muted);
  border-bottom-style: dashed;
  border-bottom-color: var(--border);
  cursor: help;
}

/* ---- 取不到的文件：说明为什么，而不是一个碎掉的 img ---- */
.export-missing-media {
  display: block;
  margin: 1em 0;
  padding: 0.7em 0.9em;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--muted);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.85rem;
  text-align: center;
}
.export-link-plain { color: var(--fg); border-bottom: 1px dotted var(--border); }

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
  .prose pre { break-inside: avoid; }
  .prose .callout { break-inside: avoid; }
}
`.trim();

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

export type StandaloneOptions = {
  content?: string;
  /** 全库文档：双链据此解析目标。 */
  docs?: Document[];
  /** 读库内二进制（图片 / SVG 资源），用来内联成 data URL。 */
  readAsset?: ExportAssetReader;
};

/**
 * Build a self-contained HTML string for one document.
 *
 * 单篇独立 HTML 是「发出去一份文件」的场景：图片必须内联，否则离线必裂；
 * 双链目标不在这一份文件里，所以渲染成不可点的胶囊（带 tooltip 说明）。
 */
export async function documentToStandaloneHtml(
  doc: Document,
  contentOrOptions?: string | StandaloneOptions
): Promise<string> {
  const opts: StandaloneOptions =
    typeof contentOrOptions === "string" ? { content: contentOrOptions } : contentOrOptions ?? {};
  const raw = opts.content ?? doc.content;

  if (doc.type === "html") {
    const asIs = /<html[\s>]/i.test(raw);
    if (asIs) return raw;
    return wrapStandaloneHtml({ title: titleOf(doc.path), path: doc.path, bodyHtml: raw });
  }

  const resolvedDoc: Document = { ...doc, content: raw };
  const docs = opts.docs?.length ? opts.docs : [resolvedDoc];

  const { title, bodyHtml } = await renderMarkdownForExport({
    content: raw,
    docPath: doc.path,
    docs,
    // 单文件里没有别的页面可跳：目标写回自己才算可达，其余一律不可点。
    hrefForDoc: (target) => (target.path === doc.path ? `#${anchorSlug(title)}` : null),
    resolveAsset: opts.readAsset
      ? async (path) => {
          const file = await opts.readAsset!(path);
          return file ? `data:${file.mime};base64,${file.base64}` : null;
        }
      : undefined,
  });

  return wrapStandaloneHtml({
    title: title === "未命名" ? titleOf(doc.path) : title,
    path: doc.path,
    bodyHtml,
  });
}

function anchorSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "");
}

export function suggestExportFilename(doc: Document, kind: "html" | "md" | "source"): string {
  const base = doc.path.replace(/\\/g, "/").split("/").pop() ?? doc.path;
  const stem = base.replace(/\.(md|html)$/i, "");
  if (kind === "html") return `${stem}.html`;
  if (kind === "md") return `${stem}.md`;
  return base;
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
