"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { Copy, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { findBacklinks, resolveWikiTarget } from "@/lib/search";
import { getTags, parseFrontmatter } from "@/lib/tags";
import { countWords, readingMinutes, relativeTime, titleOf, cn } from "@/lib/utils";
import type { Document } from "@/lib/types";
import "highlight.js/styles/github-dark.css";

function WikiText({ text, docs, onOpen }: { text: string; docs: Document[]; onOpen: (id: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const target = resolveWikiTarget(docs, m[1].trim());
        const label = (m[2] || m[1]).trim();
        return (
          <button
            key={i}
            type="button"
            className={cn("wiki-link", !target && "missing")}
            onClick={() => target && onOpen(target.id)}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}

function walkChildren(children: React.ReactNode, docs: Document[], onOpen: (id: string) => void): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") return <WikiText text={child} docs={docs} onOpen={onOpen} />;
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(child, {
        children: walkChildren(child.props.children, docs, onOpen),
      });
    }
    return child;
  });
}

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const lang = /language-(\w+)/.exec(className || "")?.[1] || "";
  const text = String(children).replace(/\n$/, "");
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="not-prose my-4 overflow-hidden rounded-[14px] border border-[rgba(236,228,210,0.08)] bg-[#1a1814] text-[#ece4d2]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgba(236,228,210,0.08)] text-xs">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        <span className="ml-2 text-[var(--muted)] font-mono">{lang || "code"}</span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          <Copy className="h-3 w-3" /> {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="!m-0 !border-0 !rounded-none">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function extractOutline(md: string): { id: string; text: string; level: number }[] {
  const { body } = parseFrontmatter(md);
  const out: { id: string; text: string; level: number }[] = [];
  for (const line of body.split(/\n/)) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/[#*`]/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "");
    out.push({ id, text, level: m[1].length });
  }
  return out;
}

function renderCallouts(src: string): string {
  // Convert > [!tip] Title\n> body into a blockquote with marker paragraph
  const lines = src.split(/\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^>\s*\[!(tip|note|warn)\]\s*(.*)$/i);
    if (!m) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const kind = m[1].toLowerCase();
    const title = m[2] || ({ tip: "提示", note: "说明", warn: "注意" } as Record<string, string>)[kind];
    const body: string[] = [];
    i += 1;
    while (i < lines.length && /^>/.test(lines[i])) {
      body.push(lines[i].replace(/^>\s?/, ""));
      i += 1;
    }
    out.push(`<div class="callout ${kind}"><div class="callout-title" data-kind="${kind}">${title}</div>\n\n${body.join("\n")}\n\n</div>`);
  }
  return out.join("\n");
}

export function MarkdownReader({ doc }: { doc: Document }) {
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const openDoc = useStore((s) => s.openDoc);
  const setDocTags = useStore((s) => s.setDocTags);
  const content = getContent(doc.id);
  const { body } = parseFrontmatter(content);
  const tags = getTags({ ...doc, content });
  const words = countWords(body);
  const outline = extractOutline(content);
  const backlinks = findBacklinks(documents, doc);
  const [activeHeading, setActiveHeading] = React.useState<string>("");
  const [tagInput, setTagInput] = React.useState("");

  const prepared = React.useMemo(() => renderCallouts(body), [body]);

  React.useEffect(() => {
    const root = document.getElementById("reader-scroll");
    if (!root) return;
    const heads = [...root.querySelectorAll("h1[id],h2[id],h3[id]")];
    const onScroll = () => {
      let current = "";
      for (const h of heads) {
        const rect = h.getBoundingClientRect();
        if (rect.top <= 120) current = h.id;
      }
      setActiveHeading(current);
    };
    root.addEventListener("scroll", onScroll);
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [prepared]);

  const summary = body.replace(/^#.+$/m, "").replace(/\s+/g, " ").trim().slice(0, 80);

  return (
    <div className="h-full flex min-h-0">
      <div id="reader-scroll" className="flex-1 overflow-y-auto scroll-thin">
        <article className="prose-langhuan mx-auto px-4 md:px-8 py-8 animate-enter">
          <header className="mb-8 space-y-3 font-ui not-serif">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--accent)]">Markdown</span>
              <span>更新于 {relativeTime(doc.updatedAt)}</span>
              <span>{words} 字</span>
              <span>约 {readingMinutes(words)} 分钟</span>
            </div>
            {summary && (
              <blockquote className="!border-l-[var(--gold)] !text-[var(--muted)] !m-0 font-serif text-base">
                {summary}{summary.length >= 80 ? "…" : ""}
              </blockquote>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                  {t}
                  <button
                    type="button"
                    aria-label={`删除标签 ${t}`}
                    className="text-[var(--muted)] hover:text-[var(--accent)]"
                    onClick={() => setDocTags(doc.id, tags.filter((x) => x !== t))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <form
                className="inline-flex"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = tagInput.trim();
                  if (!t || tags.includes(t)) return;
                  setDocTags(doc.id, [...tags, t]);
                  setTagInput("");
                }}
              >
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="+ 标签"
                  className="h-7 w-24 rounded-full border border-dashed border-[var(--border)] bg-transparent px-2 text-xs focus:outline-none focus:border-[var(--accent)]"
                />
              </form>
            </div>
          </header>

          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeRaw, rehypeHighlight]}
            components={{
              p: ({ children }) => <p>{walkChildren(children, documents, openDoc)}</p>,
              li: ({ children }) => <li>{walkChildren(children, documents, openDoc)}</li>,
              td: ({ children }) => <td>{walkChildren(children, documents, openDoc)}</td>,
              h1: ({ children, id }) => <h1 id={id}>{walkChildren(children, documents, openDoc)}</h1>,
              h2: ({ children, id }) => <h2 id={id}>{walkChildren(children, documents, openDoc)}</h2>,
              h3: ({ children, id }) => <h3 id={id}>{walkChildren(children, documents, openDoc)}</h3>,
              code: ({ className, children, ...props }) => {
                const isBlock = typeof className === "string" && className.includes("language-");
                if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => <>{children}</>,
              // custom callout HTML from preprocessor may come as raw - handle via div
              div: ({ className, children, ...props }) => {
                if (typeof className === "string" && className.includes("callout")) {
                  const kind = className.includes("tip") ? "tip" : className.includes("warn") ? "warn" : "note";
                  const Icon = kind === "tip" ? Lightbulb : kind === "warn" ? TriangleAlert : Info;
                  const kids = React.Children.toArray(children);
                  const titleEl = kids.find(
                    (c) => React.isValidElement(c) && (c.props as { className?: string }).className?.includes("callout-title")
                  );
                  const rest = kids.filter((c) => c !== titleEl);
                  return (
                    <div className={`callout ${kind}`}>
                      <div className="callout-title">
                        <Icon className="h-4 w-4" />
                        {titleEl && React.isValidElement(titleEl) ? (titleEl.props as { children?: React.ReactNode }).children : kind}
                      </div>
                      <div>{rest}</div>
                    </div>
                  );
                }
                return (
                  <div className={className} {...props}>
                    {children}
                  </div>
                );
              },
            }}
          >
            {prepared}
          </ReactMarkdown>
        </article>
      </div>

      <aside className="hidden xl:flex w-[240px] shrink-0 flex-col border-l border-[var(--border)] p-4 gap-6 overflow-y-auto scroll-thin">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">大纲</div>
          <nav className="space-y-1 sticky top-0">
            {outline.length === 0 && <div className="text-xs text-[var(--muted)]">暂无标题</div>}
            {outline.map((h) => (
              <a
                key={h.id + h.text}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn(
                  "block text-sm rounded-lg px-2 py-1 hover:bg-[var(--hover)] truncate",
                  h.level === 1 && "font-medium",
                  h.level === 2 && "pl-3",
                  h.level === 3 && "pl-5 text-[var(--muted)]",
                  activeHeading === h.id && "text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                )}
              >
                {h.text}
              </a>
            ))}
          </nav>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">反向链接</div>
          <div className="space-y-1">
            {backlinks.length === 0 && <div className="text-xs text-[var(--muted)]">暂无反向链接</div>}
            {backlinks.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openDoc(b.id)}
                className="block w-full text-left text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--hover)] truncate"
              >
                {titleOf(b.path)}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
