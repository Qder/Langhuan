/**
 * GitHub / Obsidian style callouts (`> [!note] 标题`).
 *
 * One source of truth for the kinds, the header parser, and the default labels,
 * shared by:
 *  - `rehypeCallout` (preview AST → card markup)
 *  - `MarkdownReader` (icon + label + theme classes)
 *  - `mdVisualSerialize` (callout blocks edit as source, never as visual prose)
 *  - `locate/mdPlainMap` (marker line is syntax, not body text)
 *
 * Keeping the list here means a new kind only has to be added once.
 */

export const CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Default title when the header has no custom text. */
export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: "说明",
  tip: "提示",
  important: "重要",
  warning: "注意",
  caution: "小心",
};

/** Accepted spellings → canonical kind (case-insensitive at the call site). */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: "note",
  tip: "tip",
  hint: "tip",
  important: "important",
  warning: "warning",
  warn: "warning",
  caution: "caution",
  danger: "caution",
};

export function calloutKindOf(raw: string | null | undefined): CalloutKind | null {
  if (!raw) return null;
  return CALLOUT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export type CalloutHeader = {
  kind: CalloutKind;
  /** Custom title after the marker; "" when the author only wrote `[!note]`. */
  title: string;
};

/**
 * Parse a callout header line (the blockquote `>` prefix already stripped),
 * e.g. `[!TIP] 自定义标题` → `{ kind: "tip", title: "自定义标题" }`.
 *
 * Case-insensitive, tolerates Obsidian fold markers (`[!note]-` / `[!note]+`).
 * Returns null for anything that is not a recognized callout.
 */
export function parseCalloutHeader(line: string): CalloutHeader | null {
  const m = /^\s*\[!([A-Za-z][\w-]*)\][+-]?[ \t]*(.*)$/.exec(line);
  if (!m) return null;
  const kind = calloutKindOf(m[1]);
  if (!kind) return null;
  return { kind, title: (m[2] ?? "").trim() };
}

/** True for a Markdown source slice whose first line is a callout header. */
export function isCalloutSlice(slice: string): boolean {
  const first = slice.trimStart().split(/\r?\n/, 1)[0] ?? "";
  const stripped = first.replace(/^(?:>\s?)+/, "");
  return parseCalloutHeader(stripped) !== null;
}
