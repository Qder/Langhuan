/**
 * rehype-callout: turn GitHub / Obsidian callout blockquotes into cards.
 *
 *   > [!tip] 自定义标题
 *   > 正文
 *
 * becomes
 *
 *   <div class="callout callout-tip tip" data-callout="tip" data-src-start=…>
 *     <div class="callout-title" data-callout-title>自定义标题</div>
 *     <div class="callout-body" data-callout-body><p>正文</p></div>
 *   </div>
 *
 * The marker line is stripped from the AST, but **nothing else is dropped** —
 * the rest of the header paragraph (the very common `[!tip] 标题\n正文` shape)
 * moves into the body instead of disappearing.
 *
 * Runs after `rehypeSrcPositions`, so `data-src-*` is copied from the
 * blockquote onto the card: click-to-edit / split-pane locate keep pointing at
 * the same source range, and the card is still edited as `source` text.
 *
 * Nested callouts are transformed inner-first (post-order) so an outer card
 * never freezes a half-transformed child.
 */

import type { Element, ElementContent, Root, Text } from "hast";
import { visit } from "unist-util-visit";
import { CALLOUT_LABELS, calloutKindOf, type CalloutKind } from "./callout";

type SplitCallout = {
  kind: CalloutKind;
  title: ElementContent[];
  body: ElementContent[];
};

function isWhitespaceText(node: ElementContent | undefined): boolean {
  return node?.type === "text" && node.value.trim() === "";
}

/** Drop leading / trailing whitespace-only text nodes (keeps inline elements). */
function trimTextEdges(nodes: ElementContent[]): ElementContent[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && isWhitespaceText(nodes[start])) start += 1;
  while (end > start && isWhitespaceText(nodes[end - 1])) end -= 1;
  return nodes.slice(start, end);
}

/** First non-whitespace child — remark-rehype pads blockquotes with "\n" texts. */
function firstMeaningfulChild(block: Element): ElementContent | undefined {
  return block.children.find((c) => !isWhitespaceText(c));
}

/**
 * Split a callout's header paragraph into title inline nodes and body nodes.
 * Returns null when the paragraph does not start with a recognised `[!kind]`.
 */
export function splitCalloutParagraph(p: Element): SplitCallout | null {
  const kids = p.children;
  let startIdx = 0;
  while (startIdx < kids.length && isWhitespaceText(kids[startIdx])) startIdx += 1;
  const first = kids[startIdx];
  if (!first || first.type !== "text") return null;
  const m = /^[ \t]*\[!([A-Za-z][\w-]*)\][+-]?[ \t]*/.exec(first.value);
  if (!m) return null;
  const kind = calloutKindOf(m[1]);
  if (!kind) return null;

  const title: ElementContent[] = [];
  const body: ElementContent[] = [];
  let lineDone = false;

  const takeText = (value: string, isFirst: boolean) => {
    const text = isFirst ? value.slice(m[0].length) : value;
    const nl = text.indexOf("\n");
    if (nl < 0) {
      if (text) title.push({ type: "text", value: text } satisfies Text);
      return;
    }
    if (nl > 0) title.push({ type: "text", value: text.slice(0, nl) } satisfies Text);
    const tail = text.slice(nl + 1);
    if (tail) body.push({ type: "text", value: tail } satisfies Text);
    lineDone = true;
  };

  takeText(first.value, true);
  for (let i = startIdx + 1; i < kids.length; i++) {
    const child = kids[i]!;
    if (lineDone) {
      body.push(child);
      continue;
    }
    if (child.type === "text") {
      takeText(child.value, false);
    } else {
      // Inline node still on the header line (e.g. `[!tip] **重点**标题`).
      title.push(child);
    }
  }

  return { kind, title: trimTextEdges(title), body: trimTextEdges(body) };
}

export function rehypeCallout() {
  return (tree: Root) => {
    const jobs: { node: Element; parent: Element | Root; index: number }[] = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "blockquote") return;
      if (!parent || index == null) return;
      const first = firstMeaningfulChild(node);
      if (!first || first.type !== "element" || first.tagName !== "p") return;
      if (!splitCalloutParagraph(first)) return;
      jobs.push({ node, parent: parent as Element | Root, index });
    });

    // Post-order: inner callouts first, so outer slice() sees final children.
    for (let i = jobs.length - 1; i >= 0; i--) {
      const job = jobs[i]!;
      const children = job.node.children;
      const header = firstMeaningfulChild(job.node);
      if (!header || header.type !== "element") continue;
      const split = splitCalloutParagraph(header);
      if (!split) continue;

      const bodyChildren: ElementContent[] = [];
      if (split.body.length) {
        bodyChildren.push({ ...header, children: split.body });
      }
      for (const child of children) {
        if (child === header) continue;
        bodyChildren.push(child);
      }
      while (bodyChildren.length && isWhitespaceText(bodyChildren[0])) {
        bodyChildren.shift();
      }
      while (bodyChildren.length && isWhitespaceText(bodyChildren[bodyChildren.length - 1])) {
        bodyChildren.pop();
      }

      const cardChildren: ElementContent[] = [
        {
          type: "element",
          tagName: "div",
          properties: {
            className: ["callout-title"],
            "data-callout-title": true,
          },
          children: split.title.length
            ? split.title
            : [{ type: "text", value: CALLOUT_LABELS[split.kind] } satisfies Text],
        },
      ];
      if (bodyChildren.length) {
        cardChildren.push({
          type: "element",
          tagName: "div",
          properties: {
            className: ["callout-body"],
            "data-callout-body": true,
          },
          children: bodyChildren,
        });
      }

      const kind = split.kind;
      job.parent.children[job.index] = {
        type: "element",
        tagName: "div",
        properties: {
          // data-src-* stamps first; our identity props must never be clobbered.
          ...(job.node.properties || {}),
          // `warn` kept alongside `warning`: existing paper/phycat rules and
          // hand-written `class="callout warn"` HTML both stay styled.
          className:
            kind === "warning"
              ? ["callout", "callout-warning", "warning", "warn"]
              : ["callout", `callout-${kind}`, kind],
          "data-callout": kind,
        },
        children: cardChildren,
      };
    }
  };
}
