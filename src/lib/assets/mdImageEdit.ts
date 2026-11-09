/**
 * Edit markdown image alt / display width without changing the href.
 * Width is stored in the title slot as `lh-w:50%` or `lh-w:400px` (portable).
 */

export type MdImageWidth = "auto" | `${number}%` | `${number}px`;

export type MdImageMatch = {
  start: number;
  end: number;
  alt: string;
  href: string;
  title: string | null;
  width: MdImageWidth;
  full: string;
};

const IMG_RE =
  /!\[([^\]]*)\]\(\s*(<?)([^)\s>]+)(>?)\s*(?:(["'])(.*?)\5)?\s*\)/g;

export function parseLhWidth(title: string | null | undefined): MdImageWidth {
  const t = String(title || "").trim();
  const m = /^lh-w:(\d{1,3}%|\d{2,4}px)$/i.exec(t);
  if (!m) return "auto";
  return m[1] as MdImageWidth;
}

export function widthToTitle(width: MdImageWidth, prevTitle?: string | null): string | null {
  if (width === "auto") {
    const prev = String(prevTitle || "").trim();
    if (/^lh-w:/i.test(prev)) return null;
    return prev || null;
  }
  return `lh-w:${width}`;
}

export function widthToCss(width: MdImageWidth): string | undefined {
  if (width === "auto") return undefined;
  return width;
}

/** Find markdown images; prefer match whose href ends with needle (basename or full). */
export function findMarkdownImages(source: string): MdImageMatch[] {
  const out: MdImageMatch[] = [];
  IMG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(source))) {
    const alt = m[1] ?? "";
    const href = m[3] ?? "";
    const title = m[6] != null ? m[6] : null;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      alt,
      href,
      title,
      width: parseLhWidth(title),
      full: m[0],
    });
  }
  return out;
}

export function findMarkdownImageByHref(
  source: string,
  hrefOrPath: string
): MdImageMatch | null {
  const needle = hrefOrPath.replace(/\\/g, "/");
  const base = needle.split("/").pop() || needle;
  const all = findMarkdownImages(source);
  return (
    all.find((im) => im.href.replace(/\\/g, "/") === needle) ||
    all.find((im) => im.href.replace(/\\/g, "/").endsWith("/" + base)) ||
    all.find((im) => (im.href.split("/").pop() || "") === base) ||
    null
  );
}

export function rewriteMarkdownImage(
  source: string,
  match: MdImageMatch,
  next: { alt?: string; width?: MdImageWidth }
): string {
  const alt = (next.alt ?? match.alt).replace(/[[\]]/g, "");
  const width = next.width ?? match.width;
  const title = widthToTitle(width, match.title);
  const href = match.href;
  const body = title != null && title !== "" ? `![${alt}](${href} "${title}")` : `![${alt}](${href})`;
  return source.slice(0, match.start) + body + source.slice(match.end);
}
