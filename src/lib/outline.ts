export type OutlineItem = {
  id: string;
  level: number;
  text: string;
};

function slugify(text: string, used: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** Ensure h1–h6 have ids; return HTML + outline list. */
export function enrichHeadings(html: string): { html: string; outline: OutlineItem[] } {
  if (!html.trim()) return { html, outline: [] };
  const used = new Map<string, number>();
  const outline: OutlineItem[] = [];
  const out = html.replace(
    /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (_full, levelStr: string, attrs = "", inner: string) => {
      const level = Number(levelStr);
      const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const idMatch = attrs.match(/\sid\s*=\s*["']([^"']+)["']/i);
      const id = idMatch?.[1] || slugify(text || `h${level}`, used);
      const attrsWithoutId = attrs.replace(/\sid\s*=\s*["'][^"']*["']/i, "");
      outline.push({ id, level, text: text || `标题 ${level}` });
      return `<h${level}${attrsWithoutId} id="${id}">${inner}</h${level}>`;
    },
  );
  return { html: out, outline };
}

export function extractOutlineFromSource(source: string, kind: "md" | "html"): OutlineItem[] {
  if (kind === "html") {
    return enrichHeadings(source).outline;
  }
  // Markdown: parse ATX headings (# …)
  let body = source;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4).replace(/^\r?\n/, "");
  }
  const used = new Map<string, number>();
  const outline: OutlineItem[] = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/[*_`~\[\]]/g, "").trim();
    if (!text) continue;
    outline.push({ id: slugify(text, used), level, text });
  }
  return outline;
}
