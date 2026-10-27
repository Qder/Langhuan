"use client";

import * as React from "react";
import { ChevronDown, Highlighter, Link2, Trash2 } from "lucide-react";
import type { OutlineHeading } from "@/lib/outline";
import type { Document } from "@/lib/types";
import { cn, dirname, titleOf } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { findUnlinkedMentions, linkifyMention } from "@/lib/wikilink";
import { getDocMeta } from "@/lib/docMeta";
import { AssetsPanel } from "./AssetsPanel";

export type DocAsideProps = {
  outline: OutlineHeading[];
  backlinks: Document[];
  activeHeading: string;
  /** Compact popover mode (TopBar 目录). */
  variant?: "rail" | "popover";
  className?: string;
  /** Active document for 未链接的提及 / 批注 / 附件 */
  doc?: Document | null;
  /** Called when user clicks an outline item (after scroll-into-view). */
  onNavigateHeading?: (id: string) => void;
};

type TocNode = {
  heading: OutlineHeading;
  children: TocNode[];
};

function buildTocTree(outline: OutlineHeading[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of outline) {
    const node: TocNode = { heading: h, children: [] };
    while (stack.length && stack[stack.length - 1].heading.level >= h.level) {
      stack.pop();
    }
    if (!stack.length) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function TocTree({
  nodes,
  activeHeading,
  depth = 0,
  onNavigateHeading,
}: {
  nodes: TocNode[];
  activeHeading: string;
  depth?: number;
  onNavigateHeading?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  return (
    <>
      {nodes.map((n) => {
        const key = n.heading.id + n.heading.text;
        const hasKids = n.children.length > 0;
        const isCollapsed = !!collapsed[key];
        const isActive = activeHeading === n.heading.id;
        return (
          <div key={key}>
            <div className="flex items-center gap-0.5">
              {hasKids ? (
                <button
                  type="button"
                  aria-label={isCollapsed ? "展开" : "折叠"}
                  className="shrink-0 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover)]"
                  onClick={() =>
                    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
                  }
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <a
                href={`#${n.heading.id}`}
                data-outline-id={n.heading.id}
                aria-current={isActive ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateHeading?.(n.heading.id);
                  document
                    .getElementById(n.heading.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-lg px-1.5 py-1 hover:bg-[var(--hover)] transition-colors",
                  n.heading.level === 1 && "font-medium",
                  isActive &&
                    "text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                )}
                style={{ paddingLeft: 4 + Math.max(0, depth) * 8 }}
              >
                {n.heading.text}
              </a>
            </div>
            {hasKids && !isCollapsed && (
              <TocTree
                nodes={n.children}
                activeHeading={activeHeading}
                depth={depth + 1}
                onNavigateHeading={onNavigateHeading}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * On-demand outline + backlinks + unlinked mentions + annotations + assets.
 */
export function DocAside({
  outline,
  backlinks,
  activeHeading,
  variant = "rail",
  className,
  doc,
  onNavigateHeading,
}: DocAsideProps) {
  const openDoc = useStore((s) => s.requestOpenDoc);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const saveDoc = useStore((s) => s.saveDoc);
  const setStatus = useStore((s) => s.setStatus);
  const annotations = useStore((s) => s.annotations);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const assetsForDoc = useStore((s) => s.assetsForDoc);
  const [backlinksOpen, setBacklinksOpen] = React.useState(false);
  const [mentionsOpen, setMentionsOpen] = React.useState(true);
  const [annOpen, setAnnOpen] = React.useState(true);
  const asideRef = React.useRef<HTMLElement>(null);
  const ignoreOutlineScrollUntil = React.useRef(0);
  const lastSpyId = React.useRef("");

  // Keep the active outline row visible when scroll-spy advances (not when the
  // user is manually scrolling the outline list).
  React.useEffect(() => {
    if (!activeHeading || activeHeading === lastSpyId.current) {
      lastSpyId.current = activeHeading;
      return;
    }
    lastSpyId.current = activeHeading;
    if (Date.now() < ignoreOutlineScrollUntil.current) return;
    const root = asideRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-outline-id="${CSS.escape(activeHeading)}"]`
    );
    if (!el) return;
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 8;
    if (elRect.top >= rootRect.top + pad && elRect.bottom <= rootRect.bottom - pad) {
      return;
    }
    // Adjust only the aside scroller — scrollIntoView would also nudge #reader-scroll.
    const delta =
      elRect.top < rootRect.top + pad
        ? elRect.top - rootRect.top - pad
        : elRect.bottom - (rootRect.bottom - pad);
    root.scrollTop += delta;
  }, [activeHeading]);

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

  const docAnns = React.useMemo(
    () => (doc ? annotations.filter((a) => a.docId === doc.id) : []),
    [annotations, doc]
  );
  const assetCount = doc ? assetsForDoc(doc.id).length : 0;
  const tocTree = React.useMemo(() => buildTocTree(outline), [outline]);

  if (
    outline.length === 0 &&
    backlinks.length === 0 &&
    mentions.length === 0 &&
    docAnns.length === 0 &&
    assetCount === 0
  ) {
    return null;
  }

  const linkify = (m: { title: string; start: number; end: number }) => {
    if (!doc) return;
    const next = linkifyMention(getContent(doc.id), m.start, m.end, m.title);
    setDraft(doc.id, next);
    saveDoc(doc.id);
    setStatus(`已链成 [[${m.title}]]`);
  };

  return (
    <aside
      ref={asideRef}
      onScroll={() => {
        ignoreOutlineScrollUntil.current = Date.now() + 1200;
      }}
      className={cn(
        "flex flex-col gap-4 font-ui text-sm",
        variant === "rail" &&
          "w-[240px] shrink-0 sticky top-6 self-start max-h-[calc(100dvh-5.5rem)] overflow-y-auto scroll-thin",
        variant === "popover" &&
          "w-[min(280px,80vw)] max-h-[min(70vh,480px)] overflow-y-auto scroll-thin p-3",
        className
      )}
      aria-label="大纲与反向链接"
    >
      {outline.length > 0 && (
        <nav className="space-y-0.5" aria-label="大纲">
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] px-1 mb-1.5">
            大纲
          </div>
          <TocTree
            nodes={tocTree}
            activeHeading={activeHeading}
            onNavigateHeading={onNavigateHeading}
          />
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

      {docAnns.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setAnnOpen((v) => !v)}
            className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
            aria-expanded={annOpen}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", !annOpen && "-rotate-90")}
            />
            <Highlighter className="h-3 w-3" />
            划线批注 {docAnns.length}
          </button>
          {annOpen && (
            <ul className="mt-1 space-y-2">
              {docAnns.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2"
                >
                  <div className="mb-1 flex items-start gap-1">
                    <mark className={cn("lh-annot flex-1 text-xs leading-5", `lh-annot-${a.color}`)}>
                      {a.quote.length > 80 ? a.quote.slice(0, 80) + "…" : a.quote}
                    </mark>
                    <button
                      type="button"
                      aria-label="删除批注"
                      className="shrink-0 rounded p-0.5 text-[var(--muted)] hover:text-[var(--accent)]"
                      onClick={() => removeAnnotation(a.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={a.note}
                    placeholder="批注…"
                    rows={2}
                    className="w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                    onChange={(e) => updateAnnotation(a.id, { note: e.target.value })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {doc && <AssetsPanel docId={doc.id} />}
    </aside>
  );
}

/** Whether the rail has anything to show. */
export function hasDocAsideContent(
  outline: OutlineHeading[],
  backlinks: Document[],
  mentionCount = 0,
  annotationCount = 0,
  assetCount = 0
) {
  return (
    outline.length > 0 ||
    backlinks.length > 0 ||
    mentionCount > 0 ||
    annotationCount > 0 ||
    assetCount > 0
  );
}
