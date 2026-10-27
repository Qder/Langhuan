import type { Document } from "./types";
import { parseFrontmatter, setHtmlTags, setMdTags } from "./tags";
import { titleOf } from "./utils";

export type DocStatus = "draft" | "evergreen" | "archived" | "";

export const DOC_STATUS_LABEL: Record<Exclude<DocStatus, "">, string> = {
  draft: "草稿",
  evergreen: "常青",
  archived: "归档",
};

export type DocMeta = {
  title: string;
  tags: string[];
  aliases: string[];
  status: DocStatus;
  source?: string;
  fetchedAt?: string;
};

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[,，]/)
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function asStatus(v: unknown): DocStatus {
  const s = String(v || "").trim().toLowerCase();
  if (s === "draft" || s === "草稿") return "draft";
  if (s === "evergreen" || s === "常青") return "evergreen";
  if (s === "archived" || s === "归档" || s === "archive") return "archived";
  return "";
}

export function getDocMeta(doc: Document): DocMeta {
  if (doc.type === "html") {
    const kw =
      doc.content.match(/<meta\s+name=["']keywords["']\s+content=["']([^"']+)["']/i)?.[1] || "";
    const title =
      doc.content.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || titleOf(doc.path);
    const statusRaw =
      doc.content.match(/<meta\s+name=["']langhuan:status["']\s+content=["']([^"']+)["']/i)?.[1] ||
      "";
    const source =
      doc.content.match(/<meta\s+name=["']langhuan:source["']\s+content=["']([^"']+)["']/i)?.[1] ||
      undefined;
    const fetchedAt =
      doc.content.match(
        /<meta\s+name=["']langhuan:fetchedAt["']\s+content=["']([^"']+)["']/i
      )?.[1] || undefined;
    const aliasesRaw =
      doc.content.match(/<meta\s+name=["']langhuan:aliases["']\s+content=["']([^"']+)["']/i)?.[1] ||
      "";
    return {
      title,
      tags: kw
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      aliases: aliasesRaw
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      status: asStatus(statusRaw),
      source,
      fetchedAt,
    };
  }

  const { data } = parseFrontmatter(doc.content);
  return {
    title: typeof data.title === "string" && data.title ? data.title : titleOf(doc.path),
    tags: asStringArray(data.tags),
    aliases: asStringArray(data.aliases ?? data.alias),
    status: asStatus(data.status),
    source: typeof data.source === "string" ? data.source : undefined,
    fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : undefined,
  };
}

function setMdFrontmatterField(content: string, patch: Partial<DocMeta>): string {
  const { data, body } = parseFrontmatter(content);
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.tags !== undefined) data.tags = patch.tags;
  if (patch.aliases !== undefined) {
    if (patch.aliases.length) data.aliases = patch.aliases;
    else delete data.aliases;
    delete data.alias;
  }
  if (patch.status !== undefined) {
    if (patch.status) data.status = patch.status;
    else delete data.status;
  }
  if (patch.source !== undefined) {
    if (patch.source) data.source = patch.source;
    else delete data.source;
  }
  if (patch.fetchedAt !== undefined) {
    if (patch.fetchedAt) data.fetchedAt = patch.fetchedAt;
    else delete data.fetchedAt;
  }
  const lines = Object.entries(data).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
    return `${k}: ${JSON.stringify(String(v))}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body.replace(/^\n/, "")}`;
}

function upsertHtmlMeta(content: string, name: string, value: string | undefined): string {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["'][^"']*["']\\s*/?>`, "i");
  if (!value) {
    return content.replace(re, "");
  }
  const tag = `<meta name="${name}" content="${value.replace(/"/g, "&quot;")}" />`;
  if (re.test(content)) return content.replace(re, tag);
  if (/<\/head>/i.test(content)) return content.replace(/<\/head>/i, `  ${tag}\n</head>`);
  return `${tag}\n${content}`;
}

function setHtmlMeta(content: string, patch: Partial<DocMeta>): string {
  let next = content;
  if (patch.tags !== undefined) next = setHtmlTags(next, patch.tags);
  if (patch.title !== undefined) {
    if (/<title[^>]*>[^<]*<\/title>/i.test(next)) {
      next = next.replace(/<title[^>]*>[^<]*<\/title>/i, `<title>${patch.title}</title>`);
    }
  }
  if (patch.status !== undefined) {
    next = upsertHtmlMeta(next, "langhuan:status", patch.status || undefined);
  }
  if (patch.source !== undefined) {
    next = upsertHtmlMeta(next, "langhuan:source", patch.source || undefined);
  }
  if (patch.fetchedAt !== undefined) {
    next = upsertHtmlMeta(next, "langhuan:fetchedAt", patch.fetchedAt || undefined);
  }
  if (patch.aliases !== undefined) {
    next = upsertHtmlMeta(
      next,
      "langhuan:aliases",
      patch.aliases.length ? patch.aliases.join(", ") : undefined
    );
  }
  return next;
}

export function applyDocMeta(content: string, type: Document["type"], patch: Partial<DocMeta>): string {
  if (type === "md") {
    // ensure frontmatter exists when setting fields
    let base = content;
    if (!/^---\r?\n/.test(base) && Object.keys(patch).length) {
      base = setMdTags(base, patch.tags || []);
    }
    return setMdFrontmatterField(base, patch);
  }
  return setHtmlMeta(content, patch);
}

/** 「待整理」= draft or missing status on md notes that look unfinished — MVP: status===draft OR empty status with tag 待整理 */
export function matchesStatusFilter(doc: Document, filter: DocStatus | "todo" | null): boolean {
  if (!filter) return true;
  const meta = getDocMeta(doc);
  if (filter === "todo") {
    return meta.status === "draft" || meta.tags.includes("待整理");
  }
  return meta.status === filter;
}
