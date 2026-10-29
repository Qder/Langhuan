import type { Document } from "./types";
import { basename, titleOf } from "./utils";

/** One wikilink or embed occurrence in source. */
export type WikiRef = {
  raw: string;
  start: number;
  end: number;
  embed: boolean;
  /** Page target without heading */
  target: string;
  heading?: string;
  alias?: string;
};

const WIKI_RE = /(!)?\[\[([^\]\]]+?)\]\]/g;

/** Parse inner of [[...]] → target, optional #heading, optional |alias */
export function parseWikiInner(inner: string): {
  target: string;
  heading?: string;
  alias?: string;
} {
  let rest = inner.trim();
  let alias: string | undefined;
  const pipe = rest.indexOf("|");
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim() || undefined;
    rest = rest.slice(0, pipe).trim();
  }
  let heading: string | undefined;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || undefined;
    rest = rest.slice(0, hash).trim();
  }
  return { target: rest, heading, alias };
}

export function extractWikiLinks(content: string): WikiRef[] {
  const out: WikiRef[] = [];
  const re = new RegExp(WIKI_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const embed = m[1] === "!";
    const parsed = parseWikiInner(m[2]);
    if (!parsed.target && !parsed.heading) continue;
    out.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      embed,
      target: parsed.target,
      heading: parsed.heading,
      alias: parsed.alias,
    });
  }
  return out;
}

/** Names that resolve to a document (title, basename, path, aliases). */
export function docLinkNames(doc: Document, aliases: string[] = []): string[] {
  const names = new Set<string>();
  names.add(titleOf(doc.path));
  names.add(basename(doc.path));
  names.add(doc.path);
  const noExt = doc.path.replace(/\.(md|html)$/i, "");
  names.add(noExt);
  for (const a of aliases) {
    if (a.trim()) names.add(a.trim());
  }
  return [...names].filter(Boolean);
}

/** Path without extension, using `/` separators. */
export function pathTargetOf(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.(md|html)$/i, "");
}

export type WikiRewriteMapping = {
  /** Any name that currently resolves to the renamed doc (title/basename/path/aliases). */
  oldNames: string[];
  /** New title form (titleOf). Used when the original link looked like a title/basename. */
  newTarget: string;
  /** New path without extension. Used when the original link looked path-like. */
  newPathTarget?: string;
  /** Default when the matched old name is ambiguous; per-link style still wins. */
  styleHint?: "title" | "path";
};

function isPathStyleTarget(target: string, mapping: WikiRewriteMapping): boolean {
  if (target.includes("/")) return true;
  if (/\.(md|html)$/i.test(target)) return true;
  if (mapping.styleHint === "path") {
    // Only force path when the matched name itself is path-like among oldNames
    const hit = mapping.oldNames.find((n) => n === target);
    if (hit && (hit.includes("/") || /\.(md|html)$/i.test(hit))) return true;
  }
  // Exact match against a path-like oldName
  for (const n of mapping.oldNames) {
    if (n !== target) continue;
    if (n.includes("/") || /\.(md|html)$/i.test(n)) return true;
  }
  return false;
}

function pickReplacementTarget(oldTarget: string, mapping: WikiRewriteMapping): string {
  if (isPathStyleTarget(oldTarget, mapping) && mapping.newPathTarget) {
    // If user wrote with extension, keep extension on the new path target's file form
    if (/\.(md|html)$/i.test(oldTarget)) {
      const ext = oldTarget.match(/\.(md|html)$/i)?.[0] || "";
      // newPathTarget is no-ext; append same ext family if old had one
      if (mapping.newPathTarget.toLowerCase().endsWith(ext.toLowerCase())) {
        return mapping.newPathTarget;
      }
      return mapping.newPathTarget + ext;
    }
    return mapping.newPathTarget;
  }
  return mapping.newTarget;
}

/**
 * Rewrite wikilinks using a list of rename mappings (one pass).
 * Preserves heading, alias, and embed `!`; keeps path vs title writing style when possible.
 */
export function rewriteWikiLinksWithMap(
  content: string,
  mappings: WikiRewriteMapping[]
): { content: string; count: number } {
  if (!mappings.length) return { content, count: 0 };
  const prepared = mappings
    .map((m) => ({
      ...m,
      oldSet: new Set(m.oldNames.map((n) => n.trim()).filter(Boolean)),
      newTarget: m.newTarget.trim(),
      newPathTarget: m.newPathTarget?.trim() || undefined,
    }))
    .filter((m) => m.oldSet.size && m.newTarget);
  if (!prepared.length) return { content, count: 0 };

  const refs = extractWikiLinks(content);
  if (!refs.length) return { content, count: 0 };

  let count = 0;
  let next = content;
  for (let i = refs.length - 1; i >= 0; i--) {
    const r = refs[i];
    if (!r.target) continue;
    const mapping = prepared.find((m) => m.oldSet.has(r.target));
    if (!mapping) continue;
    const replacement = pickReplacementTarget(r.target, mapping);
    if (!replacement || replacement === r.target) continue;
    const heading = r.heading ? `#${r.heading}` : "";
    const alias = r.alias != null ? `|${r.alias}` : "";
    const rebuilt = `${r.embed ? "!" : ""}[[${replacement}${heading}${alias}]]`;
    next = next.slice(0, r.start) + rebuilt + next.slice(r.end);
    count += 1;
  }
  return { content: next, count };
}

/** Thin wrapper: title-style rename for a single document. */
export function rewriteWikiLinksOnRename(
  content: string,
  oldNames: string[],
  newTitle: string
): { content: string; count: number } {
  return rewriteWikiLinksWithMap(content, [
    { oldNames, newTarget: newTitle, styleHint: "title" },
  ]);
}

export type UnlinkedMention = {
  title: string;
  start: number;
  end: number;
};

/**
 * Find plain-text occurrences of library titles that are not already inside a wikilink.
 * Longer titles win; skips matches inside existing [[...]].
 */
export function findUnlinkedMentions(
  content: string,
  titles: string[],
  opts?: { excludeTitles?: string[] }
): UnlinkedMention[] {
  const exclude = new Set((opts?.excludeTitles || []).map((t) => t.trim()).filter(Boolean));
  const candidates = [...new Set(titles.map((t) => t.trim()).filter((t) => t.length >= 2))]
    .filter((t) => !exclude.has(t))
    .sort((a, b) => b.length - a.length);
  if (!candidates.length) return [];

  // Mask existing wikilinks so we don't double-count
  const masked = content.replace(/!?\[\[[^\]]+\]\]/g, (s) => " ".repeat(s.length));
  const hits: UnlinkedMention[] = [];
  const taken: boolean[] = Array(masked.length).fill(false);

  for (const title of candidates) {
    let from = 0;
    while (from < masked.length) {
      const i = masked.indexOf(title, from);
      if (i < 0) break;
      const end = i + title.length;
      // word-ish boundary: not mid alphanumeric/CJK continuation of longer token is soft;
      // skip if overlapping a taken span
      let overlap = false;
      for (let k = i; k < end; k++) {
        if (taken[k]) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        hits.push({ title, start: i, end });
        for (let k = i; k < end; k++) taken[k] = true;
      }
      from = i + 1;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Turn one plain mention into [[title]] at the given range. */
export function linkifyMention(content: string, start: number, end: number, title: string): string {
  const slice = content.slice(start, end);
  if (slice !== title) {
    // still wrap whatever is there if lengths match intent
  }
  return content.slice(0, start) + `[[${title}]]` + content.slice(end);
}

/** Build display label for a wikilink. */
export function wikiDisplayLabel(ref: Pick<WikiRef, "target" | "heading" | "alias">): string {
  if (ref.alias) return ref.alias;
  if (ref.heading) return `${ref.target} › ${ref.heading}`;
  return ref.target;
}
