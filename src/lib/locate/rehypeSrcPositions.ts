import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "pre",
  "blockquote",
  "tr",
  "td",
  "th",
  "table",
  "ul",
  "ol",
]);

/**
 * Copy mdast/hast source offsets onto DOM data attributes, shifted by frontmatter length.
 */
export function rehypeSrcPositions(fmOffset: number) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const tag = node.tagName.toLowerCase();
      // code inside pre — also tag for fence content locate
      const want =
        BLOCK_TAGS.has(tag) ||
        (tag === "code" && typeof node.properties?.className !== "undefined");
      if (!want) return;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start !== "number" || typeof end !== "number") return;
      node.properties = node.properties || {};
      node.properties["data-src-start"] = start + fmOffset;
      node.properties["data-src-end"] = end + fmOffset;
    });
  };
}
