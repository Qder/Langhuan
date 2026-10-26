import type { Document } from "./types";
import { getTags } from "./tags";
import { basename, stripHtml, titleOf } from "./utils";

export type SearchHit = {
  id: string;
  path: string;
  type: Document["type"];
  score: number;
  snippet: string;
};

function scoreField(hay: string, q: string, weight: number): number {
  const h = hay.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let s = 0;
  for (const t of terms) {
    if (!h.includes(t)) return 0;
    s += weight;
    if (h.startsWith(t)) s += weight * 0.5;
  }
  return s;
}

function snippetAround(text: string, q: string, len = 80): string {
  const lower = text.toLowerCase();
  const term = q.toLowerCase().split(/\s+/).filter(Boolean)[0] || "";
  const i = term ? lower.indexOf(term) : 0;
  if (i < 0) return text.slice(0, len) + (text.length > len ? "…" : "");
  const start = Math.max(0, i - 24);
  const end = Math.min(text.length, i + term.length + 56);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export function searchDocuments(docs: Document[], query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = titleOf(d.path);
    const tags = getTags(d).join(" ");
    const body =
      d.type === "html"
        ? stripHtml(d.content)
        : d.content.replace(/^---[\s\S]*?---\s*/, "");
    let score = 0;
    score += scoreField(title, q, 10);
    score += scoreField(d.path, q, 6);
    score += scoreField(tags, q, 5);
    score += scoreField(body, q, 1);
    if (score <= 0) continue;
    hits.push({
      id: d.id,
      path: d.path,
      type: d.type,
      score,
      snippet: snippetAround(body.replace(/\s+/g, " ").trim(), q),
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "zh"));
}

export function findBacklinks(docs: Document[], target: Document): Document[] {
  const names = new Set([titleOf(target.path), basename(target.path), target.path]);
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  return docs.filter((d) => {
    if (d.id === target.id || d.type !== "md") return false;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(d.content))) {
      if (names.has(m[1].trim())) return true;
    }
    return false;
  });
}

export function countAllBacklinks(docs: Document[]): number {
  let n = 0;
  for (const d of docs) {
    if (d.type !== "md") continue;
    n += (d.content.match(/\[\[[^\]]+\]\]/g) || []).length;
  }
  return n;
}

export function resolveWikiTarget(docs: Document[], name: string): Document | undefined {
  const n = name.trim();
  return (
    docs.find((d) => titleOf(d.path) === n) ||
    docs.find((d) => basename(d.path) === n) ||
    docs.find((d) => d.path === n) ||
    docs.find((d) => d.path.endsWith("/" + n) || d.path.endsWith("/" + n + ".md"))
  );
}
