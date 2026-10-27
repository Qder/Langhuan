"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveWikiTarget } from "@/lib/search";
import { parseFrontmatter } from "@/lib/tags";
import { extractOutline } from "@/lib/outline";
import { titleOf, cn } from "@/lib/utils";
import type { Document } from "@/lib/types";

function sectionBody(md: string, heading?: string): string {
  const { body } = parseFrontmatter(md);
  if (!heading) {
    // truncate long embeds
    const lines = body.trim().split("\n");
    if (lines.length > 40) return lines.slice(0, 40).join("\n") + "\n\n…";
    return body.trim();
  }
  const outline = extractOutline(md);
  const hit = outline.find(
    (h) => h.text === heading || h.id === heading || h.text.includes(heading)
  );
  if (!hit) return `> （未找到标题「${heading}」）`;
  // slice from heading line to next same-or-higher level
  const lines = body.split("\n");
  let start = -1;
  let startLevel = 1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/[#*`]/g, "").trim();
    if (text === hit.text) {
      start = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (start < 0) return `> （未找到标题「${heading}」）`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

export function WikiEmbed({
  target,
  heading,
  docs,
  onOpen,
}: {
  target: string;
  heading?: string;
  docs: Document[];
  onOpen: (id: string) => void;
}) {
  const doc = resolveWikiTarget(docs, target);
  if (!doc) {
    return (
      <div className="lh-wiki-embed missing my-3 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
        未找到嵌入「{target}」
      </div>
    );
  }
  const md = sectionBody(doc.content, heading);
  return (
    <div
      className={cn(
        "lh-wiki-embed my-4 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_90%,transparent)] overflow-hidden"
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
        onClick={() => onOpen(doc.id)}
      >
        <span className="font-medium text-[var(--fg)]">{titleOf(doc.path)}</span>
        {heading ? <span>· {heading}</span> : null}
        <span className="ml-auto opacity-70">打开</span>
      </button>
      <div className="lh-md prose-sm px-3 py-2 max-w-none text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </div>
    </div>
  );
}
