/**
 * Text normalization for search indexing only — never mutates user documents.
 */

const FULLWIDTH_OFFSET = 0xfee0;

/** Fullwidth ASCII (FF01–FF5E) → halfwidth; lowercase; collapse whitespace. */
export function normalizeText(input: string): string {
  if (!input) return "";
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xff01 && cp <= 0xff5e) {
      out += String.fromCodePoint(cp - FULLWIDTH_OFFSET);
    } else if (cp === 0x3000) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Strip YAML front matter fence from MD source. */
export function stripFrontMatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Remove script/style blocks and HTML tags; decode a few common entities. */
export function stripHtmlForIndex(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop common Markdown markup while keeping readable text for indexing.
 * Deliberately lossy; used only for the body index field.
 */
export function stripMarkdownMarkup(md: string): string {
  let s = stripFrontMatter(md);
  // fenced code: keep inner text
  s = s.replace(/```[\w-]*\r?\n([\s\S]*?)```/g, " $1 ");
  s = s.replace(/`([^`]+)`/g, " $1 ");
  s = s.replace(/!\[[^\]]*]\([^)]+\)/g, " ");
  s = s.replace(/\[([^\]]+)]\([^)]+\)/g, " $1 ");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^>\s?/gm, "");
  s = s.replace(/^(\s*[-*+]|\s*\d+\.)\s+/gm, "");
  s = s.replace(/(\*\*|__|~~)(.*?)\1/g, " $2 ");
  s = s.replace(/([*_])(.*?)\1/g, " $2 ");
  s = s.replace(/\|/g, " ");
  s = s.replace(/[-*]{3,}/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function bodyForIndex(content: string, type: "md" | "html"): string {
  if (type === "html") return stripHtmlForIndex(content);
  return stripMarkdownMarkup(content);
}
