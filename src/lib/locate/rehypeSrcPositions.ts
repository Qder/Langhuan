import type { Root, Element, Text, ElementContent } from "hast";
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
  "img",
  "figure",
  "hr",
]);

/**
 * Copy mdast/hast source offsets onto DOM data attributes, shifted by frontmatter length.
 * Also stamps data-src-line (1-based start line) and splits fenced code into per-line spans.
 */
export function rehypeSrcPositions(fmOffset: number) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const tag = node.tagName.toLowerCase();
      const want =
        BLOCK_TAGS.has(tag) ||
        (tag === "code" && typeof node.properties?.className !== "undefined") ||
        tag === "code";
      if (!want) return;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      const startLine = node.position?.start?.line;
      if (typeof start !== "number" || typeof end !== "number") return;
      node.properties = node.properties || {};
      node.properties["data-src-start"] = start + fmOffset;
      node.properties["data-src-end"] = end + fmOffset;
      if (typeof startLine === "number") {
        node.properties["data-src-line"] = startLine;
      }

      // Per-line spans inside fenced <pre><code>
      if (tag === "code" && node.children?.length) {
        annotateCodeLines(node, fmOffset);
      }
    });
  };
}

/**
 * Split text children of a code element into <span data-src-line data-src-start data-src-end>
 * so clicking a code line can locate that exact source line.
 */
function annotateCodeLines(codeNode: Element, fmOffset: number) {
  const absStart = codeNode.position?.start?.offset;
  const startLine = codeNode.position?.start?.line;
  if (typeof absStart !== "number" || typeof startLine !== "number") return;

  // Only rewrite when children are plain text (before highlight plugin wraps spans).
  // If already element children (highlight), stamp lines onto existing structure loosely.
  const onlyText = codeNode.children.every(
    (c) => c.type === "text" || (c.type === "element" && c.tagName === "span")
  );
  if (!onlyText) return;

  const fullText = flattenText(codeNode);
  if (!fullText) return;

  // Fence content usually starts after the opening ```lang\n — position on code
  // node already covers the content in remark-parse.
  const lines = fullText.split("\n");
  // If the last split is empty due to trailing newline, drop it for span count
  // but keep offsets correct by walking the original string.
  const newChildren: ElementContent[] = [];
  let local = 0;
  let lineNo = startLine;
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineStart = absStart + local;
    const lineEnd = lineStart + lineText.length;
    const span: Element = {
      type: "element",
      tagName: "span",
      properties: {
        "data-src-line": lineNo,
        "data-src-start": lineStart + fmOffset,
        "data-src-end": lineEnd + fmOffset,
        className: ["lh-code-line"],
      },
      children: [{ type: "text", value: lineText } satisfies Text],
    };
    newChildren.push(span);
    local += lineText.length;
    if (i < lines.length - 1) {
      newChildren.push({ type: "text", value: "\n" });
      local += 1;
      lineNo += 1;
    }
  }
  // Only replace if we actually built spans (avoid fighting rehype-highlight
  // when it already ran — caller should put this plugin BEFORE highlight).
  if (codeNode.children.every((c) => c.type === "text")) {
    codeNode.children = newChildren;
  }
}

function flattenText(node: Element): string {
  let out = "";
  const walk = (n: ElementContent) => {
    if (n.type === "text") out += n.value;
    else if (n.type === "element") n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return out;
}
