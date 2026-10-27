import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

let singleton: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (singleton) return singleton;
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);
  // Prefer fenced code language from class
  td.addRule("highlightedCode", {
    filter: (node) =>
      node.nodeName === "PRE" &&
      node.firstChild != null &&
      (node.firstChild as HTMLElement).nodeName === "CODE",
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector("code");
      const cls = code?.getAttribute("class") || "";
      const lang = /language-([\w+-]+)/.exec(cls)?.[1] || "";
      const text = code?.textContent || "";
      return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`;
    },
  });
  singleton = td;
  return td;
}

/** Convert HTML clipboard / page fragment to Markdown (GFM). */
export function htmlToMarkdown(html: string): string {
  const input = (html || "").trim();
  if (!input) return "";
  // Strip scripts/styles before turndown for cleaner MD
  const cleaned = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  try {
    return getTurndown().turndown(cleaned).trim() + "\n";
  } catch {
    return cleaned;
  }
}

export function looksLikeRichHtml(html: string): boolean {
  const h = (html || "").trim();
  if (!h) return false;
  // Ignore OS wrappers that are effectively plain
  if (/^<!--StartFragment-->/i.test(h) && !/<(p|div|h[1-6]|ul|ol|table|a|img|br)\b/i.test(h)) {
    return false;
  }
  return /<(p|div|h[1-6]|ul|ol|li|table|a|img|br|span|strong|em|b|i)\b/i.test(h);
}

export type ClipboardImport =
  | { mode: "md"; content: string; title?: string }
  | { mode: "html"; content: string; title?: string };

/**
 * Build a new doc payload from clipboard HTML.
 * - md: Turndown to Markdown note
 * - html: keep snapshot as HTML page
 */
export function clipboardHtmlToDoc(
  html: string,
  mode: "md" | "html",
  plainFallback = ""
): ClipboardImport {
  const titleGuess =
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
    html.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim() ||
    undefined;
  if (mode === "html") {
    const body = html.trim().startsWith("<!") || /<html[\s>]/i.test(html)
      ? html
      : `<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8" /><title>${
          titleGuess || "网页快照"
        }</title></head><body>\n${html}\n</body></html>\n`;
    return { mode: "html", content: body, title: titleGuess };
  }
  const md = htmlToMarkdown(html) || plainFallback || "";
  const front = `---\ntitle: ${titleGuess || "剪藏笔记"}\ntags: [剪藏]\n---\n\n`;
  return {
    mode: "md",
    content: front + (md.startsWith("#") ? md : `# ${titleGuess || "剪藏笔记"}\n\n${md}`),
    title: titleGuess,
  };
}
