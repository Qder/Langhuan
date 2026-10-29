import type { Document } from "../types";
import type { ParsedSearchQuery } from "../searchQuery";
import { getDocMeta } from "../docMeta";
import { getTags } from "../tags";
import { titleOf } from "../utils";
import type { IndexedDoc } from "./index";

/** Shared filter gate for legacy + index paths (title:/phrase/"..."/-exclude). */
export function docPassesParsedFilters(
  d: Document,
  parsed: ParsedSearchQuery,
  indexed?: IndexedDoc
): boolean {
  if (parsed.type && d.type !== parsed.type) return false;
  if (parsed.path && !d.path.toLowerCase().includes(parsed.path.toLowerCase())) return false;
  if (parsed.tags.length) {
    const tags = getTags(d);
    if (!parsed.tags.every((t) => tags.includes(t))) return false;
  }

  const title = titleOf(d.path).toLowerCase();
  const aliases = getDocMeta(d).aliases.map((a) => a.toLowerCase());
  if (parsed.titles.length) {
    for (const t of parsed.titles) {
      const q = t.toLowerCase();
      if (!title.includes(q) && !aliases.some((a) => a.includes(q))) return false;
    }
  }

  const hayFields = indexed
    ? [
        indexed.fields.title,
        indexed.fields.aliases,
        indexed.fields.path,
        indexed.fields.tags,
        indexed.fields.body,
      ]
    : null;

  if (parsed.phrases.length) {
    for (const ph of parsed.phrases) {
      const q = ph.toLowerCase();
      if (hayFields) {
        if (!hayFields.some((h) => h.includes(q))) return false;
      } else {
        // legacy: check title/path/tags/aliases/body lightly
        const body =
          d.type === "html"
            ? d.content.toLowerCase()
            : d.content.replace(/^---[\s\S]*?---\s*/, "").toLowerCase();
        const blob = `${title} ${aliases.join(" ")} ${d.path.toLowerCase()} ${getTags(d).join(" ").toLowerCase()} ${body}`;
        if (!blob.includes(q)) return false;
      }
    }
  }

  if (parsed.excludes.length) {
    for (const ex of parsed.excludes) {
      const q = ex.toLowerCase();
      if (hayFields) {
        if (hayFields.some((h) => h.includes(q))) return false;
      } else {
        const body =
          d.type === "html"
            ? d.content.toLowerCase()
            : d.content.replace(/^---[\s\S]*?---\s*/, "").toLowerCase();
        const blob = `${title} ${aliases.join(" ")} ${d.path.toLowerCase()} ${getTags(d).join(" ").toLowerCase()} ${body}`;
        if (blob.includes(q)) return false;
      }
    }
  }

  return true;
}

export function hasActiveFilters(parsed: ParsedSearchQuery): boolean {
  return (
    parsed.tags.length > 0 ||
    !!parsed.path ||
    !!parsed.type ||
    parsed.titles.length > 0 ||
    parsed.phrases.length > 0
  );
}
