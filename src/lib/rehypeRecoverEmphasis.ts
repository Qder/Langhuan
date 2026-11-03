/**
 * Recover CommonMark-failed emphasis such as `**|A| foo**`.
 *
 * CommonMark left-flanking rules reject `**` when it is preceded by a word
 * character and followed by Unicode punctuation (`|` in cardinality `|A|`).
 * Typora/Obsidian still bold those spans; without recovery the preview shows
 * literal asterisks. This plugin only rewrites the HTML AST (no source / offset
 * drift).
 */

import type { Element, ElementContent, Root, Text } from "hast";
import { visitParents } from "unist-util-visit-parents";

const SKIP_TAGS = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "script",
  "style",
  "svg",
  "math",
]);

/** Split a text value into text / strong nodes for unparsed `**` / `__` pairs. */
export function splitRecoveredEmphasis(value: string): ElementContent[] {
  if (!value.includes("**") && !value.includes("__")) {
    return [{ type: "text", value }];
  }
  const out: ElementContent[] = [];
  // Non-greedy inner; same opener/closer. Skip empty bodies.
  const re = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    if (m.index > last) {
      out.push({ type: "text", value: value.slice(last, m.index) });
    }
    out.push({
      type: "element",
      tagName: "strong",
      properties: {},
      children: [{ type: "text", value: m[2]! }],
    });
    last = m.index + m[0].length;
  }
  if (last < value.length) {
    out.push({ type: "text", value: value.slice(last) });
  }
  return out.length ? out : [{ type: "text", value }];
}

function isSkippedAncestor(
  ancestors: Array<{ type: string; tagName?: string }>
): boolean {
  return ancestors.some(
    (a) => a.type === "element" && a.tagName != null && SKIP_TAGS.has(a.tagName)
  );
}

export function rehypeRecoverEmphasis() {
  return (tree: Root) => {
    const jobs: { parent: Element; index: number; parts: ElementContent[] }[] =
      [];
    visitParents(tree, "text", (node: Text, ancestors) => {
      if (isSkippedAncestor(ancestors)) return;
      const parent = ancestors[ancestors.length - 1] as Element | undefined;
      if (!parent || parent.type !== "element" || !parent.children) return;
      const value = node.value;
      if (!value.includes("**") && !value.includes("__")) return;
      const parts = splitRecoveredEmphasis(value);
      if (parts.length === 1 && parts[0]?.type === "text") return;
      const idx = parent.children.indexOf(node as ElementContent);
      if (idx < 0) return;
      jobs.push({ parent, index: idx, parts });
    });
    // Apply back-to-front so earlier indices stay valid within the same parent.
    jobs.sort((a, b) => {
      if (a.parent !== b.parent) return 0;
      return b.index - a.index;
    });
    for (const job of jobs) {
      job.parent.children.splice(job.index, 1, ...job.parts);
    }
  };
}
