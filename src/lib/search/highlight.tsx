import * as React from "react";
import type { SnippetMark } from "./snippets";

/**
 * Split `text` by mark ranges into React nodes with <mark>.
 * No HTML string concatenation — safe against XSS.
 */
export function renderSnippetMarks(
  text: string,
  marks: SnippetMark[] | undefined
): React.ReactNode {
  if (!marks?.length) return text;
  const cps = [...text];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  marks.forEach((m, i) => {
    const start = Math.max(0, Math.min(cps.length, m.start));
    const end = Math.max(start, Math.min(cps.length, m.end));
    if (start > cursor) {
      nodes.push(cps.slice(cursor, start).join(""));
    }
    if (end > start) {
      nodes.push(
        <mark
          key={`m-${i}-${start}`}
          className="rounded-sm bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] text-inherit px-0.5"
        >
          {cps.slice(start, end).join("")}
        </mark>
      );
    }
    cursor = end;
  });
  if (cursor < cps.length) nodes.push(cps.slice(cursor).join(""));
  return nodes;
}
