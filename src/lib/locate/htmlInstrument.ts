/**
 * Instrument a COPY of user HTML for iframe preview:
 * inject data-lh="start-end" on element start tags using parse5
 * sourceCodeLocationInfo. Mapping values are always ORIGINAL source offsets.
 * Never mutate saved/exported source.
 */

import { parse, type DefaultTreeAdapterMap } from "parse5";
import { lineAtOffset } from "./frontmatter";

type P5Node = DefaultTreeAdapterMap["node"];
type P5Element = DefaultTreeAdapterMap["element"];

const SKIP_TAGS = new Set(["html", "head", "body", "template"]);

export type InstrumentedHtml = {
  /** srcDoc copy with data-lh attributes (and caller may append bridge). */
  html: string;
  /** Number of elements annotated. */
  count: number;
};

export type InstrumentOptions = {
  /** Attribute name; default data-lh. */
  attr?: string;
};

function isElement(node: P5Node): node is P5Element {
  return (
    !!node &&
    typeof (node as P5Element).tagName === "string" &&
    Array.isArray((node as P5Element).childNodes)
  );
}

/**
 * Collect start-tag injection points from the parse tree.
 * Insertions are relative to the ORIGINAL source string.
 */
export function collectLhInsertions(
  source: string,
  attr = "data-lh"
): Array<{ at: number; text: string; start: number; end: number }> {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const insertions: Array<{ at: number; text: string; start: number; end: number }> =
    [];

  const walk = (node: P5Node) => {
    if (isElement(node)) {
      const tag = node.tagName.toLowerCase();
      const loc = node.sourceCodeLocation;
      // Skip implicitly created tags (no location) and structural roots.
      if (loc?.startTag && !SKIP_TAGS.has(tag)) {
        const start = loc.startOffset ?? loc.startTag.startOffset;
        const end = loc.endOffset ?? loc.startTag.endOffset;
        const startTagEnd = loc.startTag.endOffset;
        // Insert before the final '>' of the start tag. Handle `/>`.
        let at = startTagEnd - 1;
        if (at > 0 && source[at - 1] === "/") {
          at = startTagEnd - 2;
        }
        // Avoid double-inject if already present in this start tag slice.
        const openSlice = source.slice(loc.startTag.startOffset, startTagEnd);
        if (!new RegExp(`\\s${attr}\\s*=`).test(openSlice)) {
          insertions.push({
            at,
            text: ` ${attr}="${start}-${end}"`,
            start,
            end,
          });
        }
      }
      for (const child of node.childNodes) walk(child);
    } else if (
      node &&
      "childNodes" in node &&
      Array.isArray((node as { childNodes: P5Node[] }).childNodes)
    ) {
      for (const child of (node as { childNodes: P5Node[] }).childNodes) walk(child);
    }
  };

  walk(doc);

  // Highest offset first so earlier indices stay valid while splicing.
  insertions.sort((a, b) => b.at - a.at);
  // Deduplicate identical insertion points (keep first = highest end range).
  const seen = new Set<number>();
  return insertions.filter((ins) => {
    if (seen.has(ins.at)) return false;
    seen.add(ins.at);
    return true;
  });
}

/**
 * Return a preview-only HTML copy with data-lh on each real start tag.
 * Does not touch text inside script/style/textarea/pre (only start-tag attrs).
 */
export function instrumentHtmlSrcDoc(
  source: string,
  opts: InstrumentOptions = {}
): InstrumentedHtml {
  const attr = opts.attr ?? "data-lh";
  if (!source) return { html: source, count: 0 };

  const insertions = collectLhInsertions(source, attr);
  let html = source;
  for (const ins of insertions) {
    html = html.slice(0, ins.at) + ins.text + html.slice(ins.at);
  }
  return { html, count: insertions.length };
}

/** Strip data-lh and the locate bridge from HTML (safety for export paths). */
export function stripInstrumentation(html: string): string {
  let out = html.replace(/\sdata-lh=(["'])\d+-\d+\1/gi, "");
  out = out.replace(/<script[^>]*data-lh-bridge=["']1["'][^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[^>]*data-lh-preview-chrome=["']1["'][^>]*>[\s\S]*?<\/style>/gi, "");
  return out;
}

/** Convenience: line range for a data-lh pair. */
export function rangeToLines(
  source: string,
  start: number,
  end: number
): { startLine: number; endLine: number } {
  return {
    startLine: lineAtOffset(source, start),
    endLine: lineAtOffset(source, Math.max(start, end - 1)),
  };
}
