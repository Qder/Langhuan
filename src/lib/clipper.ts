import { htmlToMarkdown } from "./htmlToMarkdown";

export type ClipFetchResult =
  | {
      ok: true;
      title: string;
      markdown: string;
      source: string;
      fetchedAt: string;
      content: string;
    }
  | { ok: false; message: string };

function guessTitle(html: string, url: string): string {
  return (
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
    html.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim() ||
    url.replace(/^https?:\/\//, "").slice(0, 48)
  );
}

/** Best-effort URL → Markdown. Many sites block CORS; bookmarklet is the reliable path. */
export async function fetchUrlAsMarkdown(url: string): Promise<ClipFetchResult> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, message: "请输入以 http:// 或 https:// 开头的链接" };
  }
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(u, { mode: "cors", credentials: "omit" });
    if (!res.ok) {
      return {
        ok: false,
        message: `抓取失败 HTTP ${res.status}。多数网站禁止跨域，请用书签剪藏或「从剪贴板导入网页」。`,
      };
    }
    const html = await res.text();
    const title = guessTitle(html, u).replace(/[/\\?%*:|"<>]/g, "-");
    const md = htmlToMarkdown(html);
    const content = `---\ntitle: ${JSON.stringify(title)}\ntags: [剪藏]\nsource: ${JSON.stringify(
      u
    )}\nfetchedAt: ${JSON.stringify(fetchedAt)}\nstatus: draft\n---\n\n# ${title}\n\n> 来源：[${u}](${u}) · 抓取于 ${fetchedAt}\n\n${md}`;
    return { ok: true, title, markdown: md, source: u, fetchedAt, content };
  } catch {
    return {
      ok: false,
      message:
        "无法直接抓取（跨域或网络错误）。请安装书签剪藏，或在浏览器复制网页后用「从剪贴板导入网页」。",
    };
  }
}

/**
 * Minimal bookmarklet: copy page title + HTML to clipboard, then alert user.
 * User pastes via 琅嬛 「从剪贴板导入网页」.
 */
export function bookmarkletScript(): string {
  const body = `(()=>{try{const t=document.title||'剪藏';const h=document.documentElement.outerHTML;const i=async()=>{try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([h],{type:'text/html'}),'text/plain':new Blob([t+'\\n'+location.href],{type:'text/plain'})})]);alert('琅嬛：已复制「'+t+'」。回到琅嬛 → ⌘K → 从剪贴板导入网页。');}catch(e){prompt('复制失败，请手动全选复制后回琅嬛导入。源链接：',location.href);}};i();}catch(e){alert('琅嬛剪藏失败');}})();`;
  return `javascript:${encodeURIComponent(body)}`;
}

export function buildClipFromHtml(
  html: string,
  sourceUrl?: string
): { title: string; content: string } {
  const fetchedAt = new Date().toISOString();
  const title = guessTitle(html, sourceUrl || "剪藏笔记").replace(/[/\\?%*:|"<>]/g, "-");
  const md = htmlToMarkdown(html);
  const sourceLine = sourceUrl
    ? `source: ${JSON.stringify(sourceUrl)}\nfetchedAt: ${JSON.stringify(fetchedAt)}\n`
    : "";
  const content = `---\ntitle: ${JSON.stringify(title)}\ntags: [剪藏]\n${sourceLine}status: draft\n---\n\n# ${title}\n\n${
    sourceUrl ? `> 来源：[${sourceUrl}](${sourceUrl}) · 抓取于 ${fetchedAt}\n\n` : ""
  }${md}`;
  return { title, content };
}
