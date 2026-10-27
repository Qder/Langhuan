"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Copy, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { flattenCodeText, isMermaidLanguage } from "@/lib/codeText";
import { mdSanitizeSchema } from "@/lib/mdSanitizeSchema";
import { resolveLibraryHref, resolveMediaSrc } from "@/lib/resolveLibraryPath";
import { MermaidBlock } from "./MermaidBlock";
import { WikiLink } from "./WikiLink";
import { useStore } from "@/lib/store";
import { findBacklinks } from "@/lib/search";
import { getTags, parseFrontmatter } from "@/lib/tags";
import { countWords, readingMinutes, relativeTime, titleOf, cn } from "@/lib/utils";
import type { Document } from "@/lib/types";
import {
  frontmatterOffset,
  getPreviewSelectionInfo,
  isTrivialSelection,
  locateInMarkdown,
  srcAttrs,
} from "@/lib/locate";
import { rehypeSrcPositions } from "@/lib/locate/rehypeSrcPositions";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";
import { SelectionFloatBar } from "./locate/SelectionFloatBar";
import { ResizeGutter } from "./ui/ResizeGutter";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

function WikiText({ text, docs, onOpen }: { text: string; docs: Document[]; onOpen: (id: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const name = m[1].trim();
        const label = (m[2] || m[1]).trim();
        return <WikiLink key={i} name={name} label={label} docs={docs} onOpen={onOpen} />;
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

function CodeBlock({
  className,
  children,
  srcStart,
  srcEnd,
}: {
  className?: string;
  children: React.ReactNode;
  srcStart?: number;
  srcEnd?: number;
}) {
  const lang = /language-(\w+)/.exec(className || "")?.[1] || "";
  const text = flattenCodeText(children).replace(/\n$/, "");
  const [copied, setCopied] = React.useState(false);
  const attrs =
    typeof srcStart === "number" && typeof srcEnd === "number"
      ? { "data-src-start": srcStart, "data-src-end": srcEnd }
      : {};
  return (
    <div
      className="lh-codeblock not-prose my-5 overflow-hidden rounded-[14px] border border-[rgba(236,228,210,0.08)] bg-[#1a1814] text-[#ece4d2]"
      {...attrs}
    >
      <div className="lh-codeblock-chrome flex items-center gap-2 px-3 py-2 border-b border-[rgba(236,228,210,0.08)] text-xs">
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
      <div className="lh-codeblock-body flex min-w-0 overflow-x-auto">
        <div className="lh-code-gutter" aria-hidden>
          {Array.from({ length: Math.max(1, text.split("\n").length) }, (_, i) => (
            <div key={i} className="lh-code-gutter-line">
              {i + 1}
            </div>
          ))}
        </div>
        <pre className="!m-0 !border-0 !rounded-none flex-1 min-w-0">
          <code className={className}>{children}</code>
        </pre>
      </div>
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

function calloutKindFromChildren(children: React.ReactNode): {
  kind: "tip" | "note" | "warn" | null;
  title: string;
  rest: React.ReactNode;
} {
  const kids = React.Children.toArray(children);
  const first = kids[0];
  if (!React.isValidElement<{ children?: React.ReactNode }>(first)) {
    return { kind: null, title: "", rest: children };
  }
  const raw = String(
    React.Children.toArray(first.props.children)
      .map((c) => (typeof c === "string" ? c : ""))
      .join("")
  );
  const m = raw.match(/^\[!(tip|note|warn)\]\s*(.*)$/i);
  if (!m) return { kind: null, title: "", rest: children };
  const kind = m[1].toLowerCase() as "tip" | "note" | "warn";
  const title =
    m[2] || ({ tip: "提示", note: "说明", warn: "注意" } as Record<string, string>)[kind];
  return { kind, title, rest: kids.slice(1) };
}

type HastNode = {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  properties?: Record<string, unknown>;
};

export function MarkdownReader({ doc }: { doc: Document }) {
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const openDoc = useStore((s) => s.openDoc);
  const setDocTags = useStore((s) => s.setDocTags);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const pendingPreviewLocate = useStore((s) => s.pendingPreviewLocate);
  const clearPendingPreviewLocate = useStore((s) => s.clearPendingPreviewLocate);
  const setStatus = useStore((s) => s.setStatus);
  const outlineWidth = useStore((s) => s.outlineWidth);
  const setOutlineWidth = useStore((s) => s.setOutlineWidth);
  const content = getContent(doc.id);
  const fmOffset = frontmatterOffset(content);
  const { body } = parseFrontmatter(content);
  const tags = getTags({ ...doc, content });
  const words = countWords(body);
  const outline = extractOutline(content);
  const backlinks = findBacklinks(documents, doc);
  const [activeHeading, setActiveHeading] = React.useState<string>("");
  const [tagInput, setTagInput] = React.useState("");
  const articleRef = React.useRef<HTMLElement>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [floatRect, setFloatRect] = React.useState<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);

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
  }, [body]);

  const runLocate = React.useCallback(() => {
    const root = articleRef.current;
    if (!root) return;
    const info = getPreviewSelectionInfo(root);
    if (!info || isTrivialSelection(info.text)) {
      setStatus("请先选中一段文字");
      setMenu(null);
      return;
    }
    const result = locateInMarkdown({
      source: content,
      selectedText: info.text,
      startBlock: info.startBlock,
      endBlock: info.endBlock,
      anchorPlainOffset: info.anchorPlainOffset,
    });
    applyLocateResult(result);
    setMenu(null);
    setFloatRect(null);
  }, [content, applyLocateResult, setStatus]);

  // selection float bar
  React.useEffect(() => {
    const onSel = () => {
      const root = articleRef.current;
      if (!root) return;
      const info = getPreviewSelectionInfo(root);
      if (!info || isTrivialSelection(info.text) || !info.rect || info.rect.width === 0) {
        setFloatRect(null);
        return;
      }
      setFloatRect({
        top: info.rect.top,
        left: info.rect.left,
        bottom: info.rect.bottom,
        right: info.rect.right,
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // ⌘/Ctrl+Enter
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || e.shiftKey) return;
      const root = articleRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.anchorNode)) return;
      e.preventDefault();
      runLocate();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [runLocate]);

  // Source → Preview highlight
  React.useEffect(() => {
    if (!pendingPreviewLocate) return;
    const root = articleRef.current;
    if (!root) {
      clearPendingPreviewLocate();
      return;
    }
    const offset = pendingPreviewLocate.offset;
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-src-start]")];
    let target: HTMLElement | null = null;
    for (const el of blocks) {
      const s = Number(el.getAttribute("data-src-start"));
      const e = Number(el.getAttribute("data-src-end"));
      if (offset >= s && offset < e) {
        target = el;
        break;
      }
      if (offset === e) target = el;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("lh-preview-flash");
      const t = window.setTimeout(() => {
        target?.classList.remove("lh-preview-flash");
      }, 1200);
      clearPendingPreviewLocate();
      return () => clearTimeout(t);
    }
    clearPendingPreviewLocate();
  }, [pendingPreviewLocate, clearPendingPreviewLocate, body]);

  const summary = body.replace(/^#.+$/m, "").replace(/\s+/g, " ").trim().slice(0, 80);

  const onContextMenu = (e: React.MouseEvent) => {
    const root = articleRef.current;
    if (!root) return;
    const info = getPreviewSelectionInfo(root);
    if (!info || isTrivialSelection(info.text)) {
      // allow default menu
      return;
    }
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems = React.useMemo((): ContextMenuItem[] => {
    const root = articleRef.current;
    const info = root ? getPreviewSelectionInfo(root) : null;
    const text = info?.text ?? "";
    return [
      {
        id: "locate",
        label: "在源码中定位",
        shortcut: "⌘↵",
        onSelect: () => runLocate(),
      },
      {
        id: "copy",
        label: "复制",
        onSelect: async () => {
          await navigator.clipboard.writeText(text);
          setStatus("已复制");
        },
      },
      {
        id: "copy-md",
        label: "复制为 Markdown",
        onSelect: async () => {
          if (info?.startBlock) {
            const slice = content.slice(
              info.startBlock.start,
              (info.endBlock ?? info.startBlock).end
            );
            const result = locateInMarkdown({
              source: content,
              selectedText: text,
              startBlock: info.startBlock,
              endBlock: info.endBlock,
              anchorPlainOffset: info.anchorPlainOffset,
            });
            if (result.precision === "exact" || result.precision === "block") {
              await navigator.clipboard.writeText(content.slice(result.start, result.end));
              setStatus("已复制 Markdown");
              return;
            }
            void slice;
          }
          await navigator.clipboard.writeText(text);
          setStatus("已复制");
        },
      },
      {
        id: "wikilink",
        label: "添加到双链",
        onSelect: async () => {
          const link = `[[${text.trim()}]]`;
          await navigator.clipboard.writeText(link);
          setStatus("已复制双链语法");
        },
      },
    ];
  }, [runLocate, content, setStatus, menu]);

  const withSrc = (
    Tag: keyof React.JSX.IntrinsicElements,
    node: HastNode | undefined,
    props: Record<string, unknown>,
    children: React.ReactNode
  ) => {
    const attrs = srcAttrs(fmOffset, node);
    return React.createElement(Tag, { ...props, ...attrs }, children);
  };

  return (
    <div className="h-full flex min-h-0">
      <div id="reader-scroll" className="flex-1 overflow-y-auto scroll-thin">
        <article
          ref={articleRef}
          className="prose-langhuan mx-auto px-4 md:px-8 py-8 animate-enter"
          onContextMenu={onContextMenu}
        >
          <header className="mb-8 space-y-3 font-ui not-serif">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--accent)]">
                Markdown
              </span>
              <span>更新于 {relativeTime(doc.updatedAt)}</span>
              <span>{words} 字</span>
              <span>约 {readingMinutes(words)} 分钟</span>
            </div>
            {summary && (
              <blockquote className="!border-l-[var(--gold)] !text-[var(--muted)] !m-0 font-serif text-base">
                {summary}
                {summary.length >= 80 ? "…" : ""}
              </blockquote>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
                >
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
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[
              rehypeKatex,
              rehypeSlug,
              rehypeRaw,
              [rehypeSanitize, mdSanitizeSchema],
              [rehypeHighlight, { plainText: ["mermaid"] }],
              rehypeSrcPositions(fmOffset),
            ]}
            components={{
              p: ({ node, children, ...props }) =>
                withSrc("p", node as HastNode, props as Record<string, unknown>, walkChildren(children, documents, openDoc)),
              li: ({ node, children, ...props }) =>
                withSrc("li", node as HastNode, props as Record<string, unknown>, walkChildren(children, documents, openDoc)),
              td: ({ node, children, ...props }) =>
                withSrc("td", node as HastNode, props as Record<string, unknown>, walkChildren(children, documents, openDoc)),
              th: ({ node, children, ...props }) =>
                withSrc("th", node as HastNode, props as Record<string, unknown>, walkChildren(children, documents, openDoc)),
              tr: ({ node, children, ...props }) =>
                withSrc("tr", node as HastNode, props as Record<string, unknown>, children),
              blockquote: ({ node, children, ...props }) => {
                const { kind, title, rest } = calloutKindFromChildren(children);
                const attrs = srcAttrs(fmOffset, node as HastNode);
                if (kind) {
                  const Icon = kind === "tip" ? Lightbulb : kind === "warn" ? TriangleAlert : Info;
                  return (
                    <div className={`callout ${kind}`} {...attrs}>
                      <div className="callout-title">
                        <Icon className="h-4 w-4" />
                        {title}
                      </div>
                      <div>{rest}</div>
                    </div>
                  );
                }
                return (
                  <blockquote {...(props as React.HTMLAttributes<HTMLQuoteElement>)} {...attrs}>
                    {walkChildren(children, documents, openDoc)}
                  </blockquote>
                );
              },
              h1: ({ node, children, id, ...props }) =>
                withSrc(
                  "h1",
                  node as HastNode,
                  { ...(props as object), id } as Record<string, unknown>,
                  walkChildren(children, documents, openDoc)
                ),
              h2: ({ node, children, id, ...props }) =>
                withSrc(
                  "h2",
                  node as HastNode,
                  { ...(props as object), id } as Record<string, unknown>,
                  walkChildren(children, documents, openDoc)
                ),
              h3: ({ node, children, id, ...props }) =>
                withSrc(
                  "h3",
                  node as HastNode,
                  { ...(props as object), id } as Record<string, unknown>,
                  walkChildren(children, documents, openDoc)
                ),
              pre: ({ node, children }) => {
                // pre wraps code; attach src on CodeBlock via code element
                void node;
                return <>{children}</>;
              },
              code: ({ node, className, children, ...props }) => {
                const inline = (props as { inline?: boolean }).inline;
                const isBlock =
                  inline === false ||
                  (typeof className === "string" && /(^|\s)language-/.test(className));
                const attrs = srcAttrs(fmOffset, node as HastNode);
                if (isBlock) {
                  if (isMermaidLanguage(className)) {
                    return (
                      <MermaidBlock
                        className={className}
                        srcStart={attrs["data-src-start"]}
                        srcEnd={attrs["data-src-end"]}
                      >
                        {children}
                      </MermaidBlock>
                    );
                  }
                  return (
                    <CodeBlock
                      className={className}
                      srcStart={attrs["data-src-start"]}
                      srcEnd={attrs["data-src-end"]}
                    >
                      {children}
                    </CodeBlock>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              img: ({ src, alt, title }) => {
                const resolved = resolveMediaSrc(
                  typeof src === "string" ? src : undefined,
                  doc.path,
                  documents
                );
                if (resolved.kind === "external" || resolved.kind === "data") {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolved.src}
                      alt={alt || ""}
                      title={title}
                      className="lh-md-img"
                    />
                  );
                }
                return (
                  <span
                    className="lh-broken-img"
                    title={resolved.reason}
                    role="img"
                    aria-label={alt || "缺失图片"}
                  >
                    <span className="lh-broken-img-label">图片未找到</span>
                    <span className="lh-broken-img-path">{resolved.path || "(空路径)"}</span>
                    <span className="lh-broken-img-reason">{resolved.reason}</span>
                  </span>
                );
              },
              a: ({ href, children, ...props }) => {
                const resolved = resolveLibraryHref(
                  typeof href === "string" ? href : undefined,
                  doc.path,
                  documents
                );
                if (resolved.kind === "doc") {
                  return (
                    <button
                      type="button"
                      className="lh-lib-link"
                      onClick={() => openDoc(resolved.doc.id)}
                    >
                      {children}
                    </button>
                  );
                }
                if (
                  resolved.kind === "missing" &&
                  href &&
                  !/^(https?:|mailto:|#)/i.test(String(href))
                ) {
                  return (
                    <span className="lh-lib-link missing" title={`未找到 ${resolved.path}`}>
                      {children}
                    </span>
                  );
                }
                return (
                  <a
                    href={href}
                    target={typeof href === "string" && href.startsWith("http") ? "_blank" : undefined}
                    rel={
                      typeof href === "string" && href.startsWith("http")
                        ? "noreferrer noopener"
                        : undefined
                    }
                    {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
                  >
                    {children}
                  </a>
                );
              },
              div: ({ className, children, ...props }) => {
                if (typeof className === "string" && className.includes("callout")) {
                  const kind = className.includes("tip")
                    ? "tip"
                    : className.includes("warn")
                      ? "warn"
                      : "note";
                  const Icon = kind === "tip" ? Lightbulb : kind === "warn" ? TriangleAlert : Info;
                  const kids = React.Children.toArray(children);
                  const titleEl = kids.find(
                    (c) =>
                      React.isValidElement(c) &&
                      (c.props as { className?: string }).className?.includes("callout-title")
                  );
                  const rest = kids.filter((c) => c !== titleEl);
                  return (
                    <div className={`callout ${kind}`}>
                      <div className="callout-title">
                        <Icon className="h-4 w-4" />
                        {titleEl && React.isValidElement(titleEl)
                          ? (titleEl.props as { children?: React.ReactNode }).children
                          : kind}
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
            {body}
          </ReactMarkdown>
        </article>
      </div>

      <ResizeGutter
        className="hidden xl:flex"
        axis="horizontal"
        label="调整大纲宽度"
        value={outlineWidth}
        min={160}
        max={360}
        onDelta={(d) => {
          // Gutter is left of the outline: drag right shrinks outline
          setOutlineWidth(useStore.getState().outlineWidth - d);
        }}
        onReset={() => setOutlineWidth(240)}
      />
      <aside
        className="hidden xl:flex shrink-0 flex-col border-l border-[var(--border)] p-4 gap-6 overflow-y-auto scroll-thin"
        style={{ width: outlineWidth, minWidth: outlineWidth, maxWidth: outlineWidth }}
      >
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
                  activeHeading === h.id &&
                    "text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
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

      {menu && (
        <PreviewContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      {floatRect && !menu && <SelectionFloatBar rect={floatRect} onLocate={runLocate} />}
    </div>
  );
}
