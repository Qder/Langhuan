import type { DocKind } from "./types";

export function kindOf(path: string): DocKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "md";
}

export function isDocPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm")
  );
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseTagsValue(v: string): string[] {
  const t = v.trim();
  if (!t) return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return t
    .split(/[,\s]+/)
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

function firstHeadingOrEmpty(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("#")) {
      return t.replace(/^#+\s*/, "").trim();
    }
    if (t) break;
  }
  return "";
}

function parseMdMeta(content: string): {
  title: string;
  tags: string[];
  body: string;
} {
  const trimmed = content.replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("---")) {
    return { title: firstHeadingOrEmpty(trimmed), tags: [], body: content };
  }
  const rest = trimmed.slice(3).replace(/^[\r\n]+/, "");
  const end = rest.indexOf("\n---");
  if (end === -1) {
    return { title: firstHeadingOrEmpty(trimmed), tags: [], body: content };
  }
  const fm = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^[\r\n]+/, "");
  let title = "";
  let tags: string[] = [];
  for (const line of fm.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("title:")) title = unquote(t.slice(6).trim());
    else if (t.startsWith("tags:")) tags = parseTagsValue(t.slice(5).trim());
  }
  if (!title) title = firstHeadingOrEmpty(body);
  return { title, tags, body };
}

function parseHtmlMeta(content: string): {
  title: string;
  tags: string[];
  body: string;
} {
  let title = "";
  let tags: string[] = [];
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  const commentRe = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = commentRe.exec(content))) {
    const inner = m[1].trim();
    const lower = inner.toLowerCase();
    const pos = lower.indexOf("tags:");
    if (pos !== -1) {
      tags = parseTagsValue(inner.slice(pos + 5).trim());
      break;
    }
  }
  return { title, tags, body: content };
}

export function parseMeta(
  kind: string,
  content: string,
): { title: string; tags: string[]; body: string } {
  return kind === "html" ? parseHtmlMeta(content) : parseMdMeta(content);
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}
