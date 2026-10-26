import type { Document } from "./types";

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: content };
  const data: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val: unknown = kv[2].trim();
    if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
      val = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (typeof val === "string") {
      val = val.replace(/^["']|["']$/g, "");
    }
    data[key] = val;
  }
  return { data, body: m[2] };
}

export function getTags(doc: Document): string[] {
  if (doc.type === "md") {
    const { data } = parseFrontmatter(doc.content);
    const t = data.tags;
    if (Array.isArray(t)) return t.map(String);
    if (typeof t === "string") return t.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  }
  const m = doc.content.match(/<meta\s+name=["']keywords["']\s+content=["']([^"']+)["']/i);
  if (!m) return [];
  return m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

export function setMdTags(content: string, tags: string[]): string {
  const { data, body } = parseFrontmatter(content);
  data.tags = tags;
  const lines = Object.entries(data).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
    return `${k}: ${JSON.stringify(String(v))}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body.replace(/^\n/, "")}`;
}

export function setHtmlTags(content: string, tags: string[]): string {
  const joined = tags.join(", ");
  if (/<meta\s+name=["']keywords["']/i.test(content)) {
    return content.replace(
      /<meta\s+name=["']keywords["']\s+content=["'][^"']*["']\s*\/?>/i,
      `<meta name="keywords" content="${joined}" />`
    );
  }
  if (/<\/head>/i.test(content)) {
    return content.replace(/<\/head>/i, `  <meta name="keywords" content="${joined}" />\n</head>`);
  }
  return `<meta name="keywords" content="${joined}" />\n${content}`;
}

export function collectTagCounts(docs: Document[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of docs) {
    for (const t of getTags(d)) {
      map.set(t, (map.get(t) || 0) + 1);
    }
  }
  return map;
}
