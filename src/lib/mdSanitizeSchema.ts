/**
 * rehype-sanitize schema for Markdown preview.
 *
 * Allows GFM tables/lists, hljs/code classes, KaTeX spans, callout divs, and
 * safe media (img/video). Scripts and event handlers stay stripped.
 * Mermaid is rendered via a React component from fenced code — not raw HTML.
 */
import { defaultSchema, type Options as SanitizeOptions } from "rehype-sanitize";

const katexTags = [
  "math",
  "semantics",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mtext",
  "annotation",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mspace",
  "menclose",
];

export const mdSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  // Keep heading ids aligned with extractOutline / rehype-slug (no user-content-).
  clobberPrefix: "",
  tagNames: [
    ...(defaultSchema.tagNames || []),
    ...katexTags,
    "video",
    "source",
    "img",
    "span",
    "section",
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className"], ["class"]],
    span: [
      ...(defaultSchema.attributes?.span || []),
      ["className"],
      ["class"],
      ["style"],
      ["ariaHidden"],
      ["aria-hidden"],
    ],
    div: [...(defaultSchema.attributes?.div || []), ["className"], ["class"]],
    pre: [...(defaultSchema.attributes?.pre || []), ["className"], ["class"]],
    a: [...(defaultSchema.attributes?.a || []), ["className"], ["class"], ["target"], ["rel"]],
    img: [
      ...(defaultSchema.attributes?.img || []),
      ["src"],
      ["alt"],
      ["title"],
      ["width"],
      ["height"],
      ["className"],
      ["class"],
    ],
    video: [
      ["src"],
      ["controls"],
      ["width"],
      ["height"],
      ["poster"],
      ["className"],
      ["class"],
    ],
    source: [["src"], ["type"]],
    // KaTeX / MathML
    annotation: [["encoding"]],
    math: [["xmlns"], ["display"]],
    "*": [
      ...((defaultSchema.attributes && defaultSchema.attributes["*"]) || []),
      ["className"],
      ["class"],
      ["id"],
      ["data-src-start"],
      ["data-src-end"],
      ["data-src-line"],
      // Callout cards (rehypeCallout) — lets CSS / click-to-edit read the kind
      // without parsing the class list.
      ["data-callout"],
      // 文内目录（rehypeToc）。这两个属性是「点了跳到哪」的唯一依据，
      // 被 sanitize 剥掉就只剩一行不能点的字。
      ["data-toc"],
      ["data-toc-target"],
      ["aria-label"],
      ["role"],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), "data"],
    href: [...(defaultSchema.protocols?.href || []), "data"],
  },
};

/** Smoke helper for tests — tags that must remain allowed. */
export function sanitizeAllowsTag(tag: string): boolean {
  return (mdSanitizeSchema.tagNames || []).includes(tag);
}
