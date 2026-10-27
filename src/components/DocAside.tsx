"use client";

import * as React from "react";
import { ChevronDown, Link2 } from "lucide-react";
import type { OutlineHeading } from "@/lib/outline";
import type { Document } from "@/lib/types";
import { cn, dirname, titleOf } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { findUnlinkedMentions, linkifyMention } from "@/lib/wikilink";
import { getDocMeta } from "@/lib/docMeta";

export type DocAsideProps = {
  outline: OutlineHeading[];
  backlinks: Document[];
  activeHeading: string;
  /** Compact popover mode (TopBar 目录). */
  variant?: "rail" | "popover";
  className?: string;
  /** Active document for 未链接的提及 */
  doc?: Document | null;
};

/**
 * On-demand outline + backlinks + unlinked mentions.
 */
export function DocAside({
  outline,
  backlinks,
  activeHeading,
  variant = "rail",
  className,
  doc,
}: DocAsideProps) {
  const openDoc = useStore((s) => s.requestOpenDoc);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const saveDoc = useStore((s) => s.saveDoc);
  const setStatus = useStore((s) => s.setStatus);
  const [backlinksOpen, setBacklinksOpen] = React.useState(false);
  const [mentionsOpen, setMentionsOpen] = React.useState(true);

  const content = doc ? getContent(doc.id) : "";
  const selfTitles = React.useMemo(() => {
    if (!doc) return [] as string[];
    const meta = getDocMeta({ ...doc, content });
    return [titleOf(doc.path), meta.title, ...meta.aliases].filter(Boolean);
  }, [doc, content]);

  const mentions = React.useMemo(() => {
    if (!doc || doc.type !== "md" || !content) return [];
    const titles = documents
      .filter((d) => d.id !== doc.id)
      .flatMap((d) => {
        const m = getDocMeta(d);
        return [titleOf(d.path), m.title, ...m.aliases];
      })
      .filter((t) => t && t.length >= 2);
    return findUnlinkedMentions(content, titles, { excludeTitles: selfTitles });
  }, [doc, content, documents, selfTitles]);

  if (outline.length === 0 && backlinks.length === 0 && mentions.length === 0) return null;

  const linkify = (m: { title: string; start: number; end: number }) => {
    if (!doc) return;
    const next = linkifyMention(getContent(doc.id), m.start, m.end, m.title);
    setDraft(doc.id, next);
    saveDoc(doc.id);
    setStatus(`已链成 [[${m.title}]]`);
  };

  return (
    <aside
      className={cn(
        "flex flex-col gap-4 font-ui text-sm",
        variant === "rail" &&
          "w-[240px] shrink-0 sticky top-6 self-start max-h-[calc(100dvh-5.5rem)] overflow-y-auto scroll-thin",
        variant === "popover" && "w-[min(280px,80vw)] max-h-[min(70vh,480px)] overflow-y-auto scroll-thin p-3",
        className
      )}
      aria-label="大纲与反向链接"
    >
      {outline.length > 0 && (
        <nav className="space-y-0.5" aria-label="大纲">
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] px-1 mb-1.5">
            大纲
          </div>
          {outline.map((h) => (
            <a
              key={h.id + h.text}
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "block truncate rounded-lg px-2 py-1 hover:bg-[var(--hover)] transition-colors",
                h.level === 1 && "font-medium",
                activeHeading === h.id &&
                  "text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
              )}
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
            >
              {h.text}
            </a>
          ))}
        </nav>
      )}

      {backlinks.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setBacklinksOpen((v) => !v)}
            className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
            aria-expanded={backlinksOpen}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", !backlinksOpen && "-rotate-90")}
            />
            反向链接 {backlinks.length}
          </button>
          {backlinksOpen && (
            <ul className="mt-1 space-y-0.5">
              {backlinks.map((b) => {
                const folder = dirname(b.path);
                return (
                  <li key={b.id} className="group/bl">
                    <button
                      type="button"
                      onClick={() => openDoc(b.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--hover)] truncate"
                      title={b.path}
                    >
                      <span className="truncate min-w-0 flex-1">{titleOf(b.path)}</span>
                      {folder ? (
                        <span className="hidden group-hover/bl:inline shrink-0 max-w-[40%] truncate text-[10px] text-[var(--muted)]">
                          {folder}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {mentions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setMentionsOpen((v) => !v)}
            className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
            aria-expanded={mentionsOpen}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", !mentionsOpen && "-rotate-90")}
            />
            未链接的提及 {mentions.length}
          </button>
          {mentionsOpen && (
            <ul className="mt-1 space-y-0.5">
              {mentions.slice(0, 40).map((m, i) => (
                <li key={`${m.title}-${m.start}-${i}`}>
                  <button
                    type="button"
                    onClick={() => linkify(m)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--hover)]"
                    title={`转为 [[${m.title}]]`}
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                    <span className="truncate min-w-0 flex-1">{m.title}</span>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">一键双链</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

/** Whether the rail has anything to show. Mentions need live content — pass mentionCount when known. */
export function hasDocAsideContent(
  outline: OutlineHeading[],
  backlinks: Document[],
  mentionCount = 0
) {
  return outline.length > 0 || backlinks.length > 0 || mentionCount > 0;
}
