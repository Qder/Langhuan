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

/** Trim; reject empty or comma-containing names. */
export function normalizeTagRenameName(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t || /[,，]/.test(t)) return null;
  return t;
}

/** Replace `from` with `to` in a tag list; merge duplicates; preserve order of first occurrence. */
export function renameTagList(tags: string[], from: string, to: string): string[] | null {
  if (!tags.some((t) => t === from)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const next = t === from ? to : t;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/**
 * Rename one tag inside a single document body.
 * Markdown: only the YAML `tags` line (other frontmatter keys keep order).
 * HTML: only the keywords meta tokens. Exact match per getTags.
 */
export function renameTagInContent(
  content: string,
  type: Document["type"],
  from: string,
  to: string
): string {
  if (type === "md") {
    const m = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n?[\s\S]*)$/);
    if (!m) return content;
    const [, open, fm, close, body] = m;
    const lines = fm.split(/\r?\n/);
    let changed = false;
    const nextLines = lines.map((line) => {
      const kv = line.match(/^(tags\s*:\s*)(.*)$/);
      if (!kv) return line;
      const prefix = kv[1];
      const raw = kv[2].trim();
      let tags: string[];
      if (raw.startsWith("[") && raw.endsWith("]")) {
        tags = raw
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        tags = raw
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      const renamed = renameTagList(tags, from, to);
      if (!renamed) return line;
      changed = true;
      if (raw.startsWith("[")) {
        return `${prefix}[${renamed.map((x) => JSON.stringify(x)).join(", ")}]`;
      }
      return `${prefix}${renamed.join(", ")}`;
    });
    if (!changed) return content;
    return `${open}${nextLines.join("\n")}${close}${body}`;
  }

  const re = /(<meta\s+name=["']keywords["']\s+content=["'])([^"']+)(["']\s*\/?>)/i;
  const hit = content.match(re);
  if (!hit) return content;
  const tags = hit[2]
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const renamed = renameTagList(tags, from, to);
  if (!renamed) return content;
  return content.replace(re, `$1${renamed.join(", ")}$3`);
}

export type RenameTagLibraryResult = {
  documents: Document[];
  /** Per-id draft content after rename (only ids that had a draft and changed). */
  draftPatches: Record<string, string>;
  changedIds: string[];
};

/**
 * Rename a tag across the library. Also rewrites draft bodies when provided
 * so unsaved non-tag edits are kept (policy: 连草稿一起改).
 */
export function renameTagAcrossLibrary(
  docs: Document[],
  from: string,
  to: string,
  drafts: Record<string, string> = {}
): RenameTagLibraryResult {
  const draftPatches: Record<string, string> = {};
  const changedIds: string[] = [];
  const documents = docs.map((d) => {
    const nextContent = renameTagInContent(d.content, d.type, from, to);
    const contentChanged = nextContent !== d.content;
    if (d.id in drafts) {
      const nextDraft = renameTagInContent(drafts[d.id], d.type, from, to);
      if (nextDraft !== drafts[d.id]) {
        draftPatches[d.id] = nextDraft;
      }
    }
    if (!contentChanged) return d;
    changedIds.push(d.id);
    return { ...d, content: nextContent, updatedAt: Date.now() };
  });
  // Draft-only change (persisted body lacked tag but draft had it) still counts
  for (const id of Object.keys(draftPatches)) {
    if (!changedIds.includes(id)) changedIds.push(id);
  }
  return { documents, draftPatches, changedIds };
}
