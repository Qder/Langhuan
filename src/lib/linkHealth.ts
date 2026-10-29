/**
 * Read-only link & image health scan for the vault.
 * Does not mutate documents; UI jumps to source offsets via applyLocateResult.
 */

import GithubSlugger from "github-slugger";
import type { Document } from "./types";
import { getDocMeta } from "./docMeta";
import { buildKnowledgeGraph } from "./graph";
import { lineAtOffset } from "./locate/frontmatter";
import { outlineHeadingText } from "./outline";
import {
  isAbsoluteUrl,
  resolveMediaSrc,
  type AssetPathRef,
} from "./resolveLibraryPath";
import { resolveWikiTarget } from "./search";
import { parseFrontmatter } from "./tags";
import { basename, titleOf } from "./utils";
import { extractWikiLinks } from "./wikilink";

export type LinkHealthIssueType =
  | "dangling-wiki"
  | "missing-heading"
  | "missing-image"
  | "external-image"
  | "orphan-doc"
  | "untagged"
  | "title-clash";

export type LinkHealthIssue = {
  type: LinkHealthIssueType;
  docId: string;
  path: string;
  /** Source offset start (0 for doc-level issues). */
  start: number;
  end: number;
  /** 1-based line. */
  line: number;
  /** Short source snippet. */
  snippet: string;
  /** Extra detail (target name, reason, clash peer…). */
  detail?: string;
};

export type LinkHealthOptions = {
  /** Include docs with no tags (default false). */
  includeUntagged?: boolean;
  /** Include external http(s)/data/blob images as issues (default false; still returned in report.externalImages when collected). */
  includeExternalImages?: boolean;
  /** When true, always collect external-image issues into report.externalImages (default true). */
  collectExternalImages?: boolean;
  assets?: AssetPathRef[];
  /** Override body content (e.g. drafts). Default: doc.content. */
  getContent?: (doc: Document) => string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Yield to event loop every N docs (async scan). Default 20. */
  yieldEvery?: number;
};

export type LinkHealthReport = {
  issues: LinkHealthIssue[];
  /** External images always listed separately (collapsible in UI; not "errors" by default). */
  externalImages: LinkHealthIssue[];
  scannedDocs: number;
  aborted?: boolean;
};

export const LINK_HEALTH_TYPE_LABELS: Record<LinkHealthIssueType, string> = {
  "dangling-wiki": "失效双链",
  "missing-heading": "标题锚点缺失",
  "missing-image": "缺失图片",
  "external-image": "外链图片",
  "orphan-doc": "孤立文档",
  untagged: "无标签",
  "title-clash": "同名冲突",
};

/** Markdown image ![alt](url) — not wikilink embeds. Empty () allowed (reported missing). */
const MD_IMAGE_RE = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;

/** HTML <img … src="…"> (quoted). */
const HTML_IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])([^"']*)\1/gi;

function snippetAt(content: string, start: number, end: number, max = 80): string {
  const raw = content.slice(start, end);
  const line = raw.split(/\r?\n/, 1)[0] || raw;
  const t = line.trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function issueBase(
  doc: Document,
  content: string,
  type: LinkHealthIssueType,
  start: number,
  end: number,
  detail?: string
): LinkHealthIssue {
  return {
    type,
    docId: doc.id,
    path: doc.path,
    start,
    end,
    line: lineAtOffset(content, start),
    snippet: snippetAt(content, start, end) || detail || doc.path,
    detail,
  };
}

/** Collect matchable heading anchors for a document body. */
export function headingAnchors(doc: Document, content: string): Set<string> {
  const keys = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (!t) return;
    keys.add(t);
    keys.add(t.toLowerCase());
    const simple = t
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "");
    if (simple) keys.add(simple);
  };

  if (doc.type === "html") {
    const re = /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const attrs = m[2] || "";
      const idM = attrs.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
      if (idM) add(idM[2]);
      const text = m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text) {
        add(text);
        const slugger = new GithubSlugger();
        add(slugger.slug(text));
      }
    }
    // Loose id= on any element (common for wiki targets)
    const idRe = /\bid\s*=\s*(["'])([^"']+)\1/gi;
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(content))) add(im[2]);
    return keys;
  }

  const { body } = parseFrontmatter(content);
  const slugger = new GithubSlugger();
  for (const line of body.split(/\n/)) {
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (!hm) continue;
    const text = outlineHeadingText(hm[2]);
    if (!text) continue;
    add(text);
    add(slugger.slug(text));
  }
  return keys;
}

export function headingExists(
  anchors: Set<string>,
  heading: string | undefined
): boolean {
  if (!heading || !heading.trim()) return true;
  const h = heading.trim();
  if (anchors.has(h) || anchors.has(h.toLowerCase())) return true;
  const simple = h
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "");
  if (simple && anchors.has(simple)) return true;
  const slugger = new GithubSlugger();
  if (anchors.has(slugger.slug(h))) return true;
  return false;
}

export type ImageRef = {
  raw: string;
  start: number;
  end: number;
  src: string;
  alt?: string;
};

export function extractMarkdownImages(content: string): ImageRef[] {
  const out: ImageRef[] = [];
  const re = new RegExp(MD_IMAGE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let src = (m[2] || "").trim();
    if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1).trim();
    out.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      src,
      alt: m[1],
    });
  }
  return out;
}

export function extractHtmlImages(content: string): ImageRef[] {
  const out: ImageRef[] = [];
  const re = new RegExp(HTML_IMG_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    out.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      src: (m[2] || "").trim(),
    });
  }
  return out;
}

function unwrapSrc(src: string): string {
  return src.trim();
}

function isBadAbsolute(src: string): boolean {
  const s = src.trim();
  if (!s) return true;
  if (/^file:/i.test(s)) return true;
  return false;
}

function isHttpExternal(src: string): boolean {
  return /^https?:/i.test(src.trim()) || /^\/\//.test(src.trim());
}

/** Scan one document for wiki / heading / image issues. */
export function scanDocLinkHealth(
  doc: Document,
  docs: Document[],
  content: string,
  assets: AssetPathRef[],
  opts?: { collectExternalImages?: boolean }
): { issues: LinkHealthIssue[]; externalImages: LinkHealthIssue[] } {
  const issues: LinkHealthIssue[] = [];
  const externalImages: LinkHealthIssue[] = [];
  const collectExt = opts?.collectExternalImages !== false;

  // Cache heading anchors per target doc id
  const anchorCache = new Map<string, Set<string>>();
  const anchorsFor = (target: Document): Set<string> => {
    let a = anchorCache.get(target.id);
    if (!a) {
      a = headingAnchors(target, target.content);
      anchorCache.set(target.id, a);
    }
    return a;
  };

  for (const ref of extractWikiLinks(content)) {
    if (!ref.target) continue;
    const target = resolveWikiTarget(docs, ref.target);
    if (!target) {
      issues.push(
        issueBase(
          doc,
          content,
          "dangling-wiki",
          ref.start,
          ref.end,
          ref.embed ? `![[${ref.target}]]` : `[[${ref.target}]]`
        )
      );
      continue;
    }
    if (ref.heading && !headingExists(anchorsFor(target), ref.heading)) {
      issues.push(
        issueBase(
          doc,
          content,
          "missing-heading",
          ref.start,
          ref.end,
          `#${ref.heading} @ ${target.path}`
        )
      );
    }
  }

  const imageRefs =
    doc.type === "html"
      ? extractHtmlImages(content)
      : [...extractMarkdownImages(content), ...extractHtmlImages(content)];

  for (const img of imageRefs) {
    const src = unwrapSrc(img.src);
    if (!src || isBadAbsolute(src)) {
      issues.push(
        issueBase(
          doc,
          content,
          "missing-image",
          img.start,
          img.end,
          src ? `坏路径: ${src}` : "空 src"
        )
      );
      continue;
    }
    if (isHttpExternal(src) || (/^(data:|blob:)/i.test(src) && collectExt)) {
      // HTTP(S) → external (not an error). data:/blob: treated as ok, skip.
      if (isHttpExternal(src)) {
        if (collectExt) {
          externalImages.push(
            issueBase(doc, content, "external-image", img.start, img.end, src)
          );
        }
        continue;
      }
      continue;
    }
    if (isAbsoluteUrl(src) && !/^file:/i.test(src)) {
      // mailto / # etc. — ignore for image health
      continue;
    }
    const resolved = resolveMediaSrc(src, doc.path, docs, assets);
    if (resolved.kind === "external") {
      if (collectExt && isHttpExternal(resolved.src)) {
        externalImages.push(
          issueBase(doc, content, "external-image", img.start, img.end, resolved.src)
        );
      }
      continue;
    }
    if (resolved.kind === "missing") {
      issues.push(
        issueBase(
          doc,
          content,
          "missing-image",
          img.start,
          img.end,
          resolved.reason || resolved.path
        )
      );
    }
  }

  return { issues, externalImages };
}

/** Docs whose titleOf or basename collide (ambiguous wikilink resolution). */
export function findTitleClashes(docs: Document[]): LinkHealthIssue[] {
  const byTitle = new Map<string, Document[]>();
  for (const d of docs) {
    const t = titleOf(d.path);
    if (!t) continue;
    const list = byTitle.get(t) || [];
    list.push(d);
    byTitle.set(t, list);
  }
  const out: LinkHealthIssue[] = [];
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    const peers = group.map((d) => d.path).join(", ");
    for (const d of group) {
      out.push({
        type: "title-clash",
        docId: d.id,
        path: d.path,
        start: 0,
        end: 0,
        line: 1,
        snippet: title,
        detail: `与 ${peers} 同名（title/basename）`,
      });
    }
  }
  return out;
}

export function findOrphanDocs(docs: Document[]): LinkHealthIssue[] {
  const g = buildKnowledgeGraph(docs);
  return g.nodes
    .filter((n) => n.orphan)
    .map((n) => ({
      type: "orphan-doc" as const,
      docId: n.id,
      path: n.path,
      start: 0,
      end: 0,
      line: 1,
      snippet: n.title || titleOf(n.path),
      detail: "无入链且无出链（与图谱 orphan 一致）",
    }));
}

export function findUntaggedDocs(docs: Document[]): LinkHealthIssue[] {
  const out: LinkHealthIssue[] = [];
  for (const d of docs) {
    const meta = getDocMeta(d);
    if (meta.tags.length > 0) continue;
    out.push({
      type: "untagged",
      docId: d.id,
      path: d.path,
      start: 0,
      end: 0,
      line: 1,
      snippet: meta.title || titleOf(d.path) || basename(d.path),
      detail: "无标签",
    });
  }
  return out;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

/** Synchronous full scan (tests / small libraries). */
export function scanLinkHealthSync(
  docs: Document[],
  opts?: LinkHealthOptions
): LinkHealthReport {
  const assets = opts?.assets || [];
  const getContent = opts?.getContent || ((d: Document) => d.content);
  const issues: LinkHealthIssue[] = [];
  const externalImages: LinkHealthIssue[] = [];

  for (let i = 0; i < docs.length; i++) {
    checkAborted(opts?.signal);
    const doc = docs[i];
    const content = getContent(doc);
    const part = scanDocLinkHealth(doc, docs, content, assets, {
      collectExternalImages: opts?.collectExternalImages !== false,
    });
    issues.push(...part.issues);
    externalImages.push(...part.externalImages);
    opts?.onProgress?.(i + 1, docs.length);
  }

  issues.push(...findOrphanDocs(docs));
  issues.push(...findTitleClashes(docs));
  if (opts?.includeUntagged) {
    issues.push(...findUntaggedDocs(docs));
  }
  if (opts?.includeExternalImages) {
    issues.push(...externalImages);
  }

  return {
    issues,
    externalImages,
    scannedDocs: docs.length,
  };
}

/** Async scan with cooperative yielding (keeps UI responsive). */
export async function scanLinkHealth(
  docs: Document[],
  opts?: LinkHealthOptions
): Promise<LinkHealthReport> {
  const assets = opts?.assets || [];
  const getContent = opts?.getContent || ((d: Document) => d.content);
  const yieldEvery = opts?.yieldEvery ?? 20;
  const issues: LinkHealthIssue[] = [];
  const externalImages: LinkHealthIssue[] = [];

  try {
    for (let i = 0; i < docs.length; i++) {
      checkAborted(opts?.signal);
      const doc = docs[i];
      const content = getContent(doc);
      const part = scanDocLinkHealth(doc, docs, content, assets, {
        collectExternalImages: opts?.collectExternalImages !== false,
      });
      issues.push(...part.issues);
      externalImages.push(...part.externalImages);
      opts?.onProgress?.(i + 1, docs.length);
      if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    checkAborted(opts?.signal);
    issues.push(...findOrphanDocs(docs));
    issues.push(...findTitleClashes(docs));
    if (opts?.includeUntagged) {
      issues.push(...findUntaggedDocs(docs));
    }
    if (opts?.includeExternalImages) {
      issues.push(...externalImages);
    }

    return {
      issues,
      externalImages,
      scannedDocs: docs.length,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        issues,
        externalImages,
        scannedDocs: docs.length,
        aborted: true,
      };
    }
    throw e;
  }
}

export function groupIssuesByType(
  issues: LinkHealthIssue[]
): Map<LinkHealthIssueType, LinkHealthIssue[]> {
  const map = new Map<LinkHealthIssueType, LinkHealthIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.type) || [];
    list.push(issue);
    map.set(issue.type, list);
  }
  return map;
}

/** Markdown report for clipboard. */
export function formatLinkHealthReportMarkdown(
  report: Pick<LinkHealthReport, "issues" | "externalImages" | "scannedDocs">,
  opts?: { includeExternalImages?: boolean }
): string {
  const lines: string[] = [];
  lines.push(`# 链接体检报告`);
  lines.push("");
  lines.push(`扫描 ${report.scannedDocs} 篇文档 · 问题 ${report.issues.length} 条`);
  lines.push("");

  const grouped = groupIssuesByType(report.issues);
  const order: LinkHealthIssueType[] = [
    "dangling-wiki",
    "missing-heading",
    "missing-image",
    "orphan-doc",
    "title-clash",
    "untagged",
    "external-image",
  ];

  let any = false;
  for (const type of order) {
    const list = grouped.get(type);
    if (!list?.length) continue;
    any = true;
    lines.push(`## ${LINK_HEALTH_TYPE_LABELS[type]}（${list.length}）`);
    lines.push("");
    for (const issue of list) {
      const loc =
        issue.start > 0 || issue.end > 0
          ? `:${issue.line}`
          : "";
      const detail = issue.detail ? ` — ${issue.detail}` : "";
      lines.push(
        `- \`${issue.path}${loc}\` \`${issue.snippet.replace(/`/g, "'")}\`${detail}`
      );
    }
    lines.push("");
  }

  if (
    opts?.includeExternalImages &&
    report.externalImages.length &&
    !grouped.get("external-image")?.length
  ) {
    any = true;
    lines.push(
      `## ${LINK_HEALTH_TYPE_LABELS["external-image"]}（${report.externalImages.length}）`
    );
    lines.push("");
    for (const issue of report.externalImages) {
      lines.push(
        `- \`${issue.path}:${issue.line}\` \`${issue.snippet.replace(/`/g, "'")}\`${
          issue.detail ? ` — ${issue.detail}` : ""
        }`
      );
    }
    lines.push("");
  }

  if (!any) {
    lines.push("未发现问题。");
    lines.push("");
  }
  return lines.join("\n");
}

/** Problem counts excluding optional categories unless included in issues. */
export function linkHealthProblemCount(issues: LinkHealthIssue[]): number {
  return issues.filter((i) => i.type !== "external-image").length;
}
