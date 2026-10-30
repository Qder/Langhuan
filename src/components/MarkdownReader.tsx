"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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
import { WikiEmbed } from "./WikiEmbed";
import { findUnlinkedMentions, parseWikiInner, wikiDisplayLabel } from "@/lib/wikilink";
import { DocAside, hasDocAsideContent } from "./DocAside";
import { getDocMeta } from "@/lib/docMeta";
import { useStore } from "@/lib/store";
import { findBacklinks } from "@/lib/search";
import {
  extractOutline,
  OUTLINE_SPY_THRESHOLD_PX,
  resolveActiveHeadingId,
  measureHeadingContentTops,
  headingViewportTops,
  type HeadingContentTop,
} from "@/lib/outline";
import { getTags, parseFrontmatter } from "@/lib/tags";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { countWords, readingMinutes, relativeTime, cn, titleOf } from "@/lib/utils";
import type { Document } from "@/lib/types";
import {
  frontmatterOffset,
  frontmatterLineOffset,
  lineAtOffset,
  getPreviewSelectionInfo,
  isTrivialSelection,
  locateInMarkdown,
  previewTopToSourceOffsetSorted,
  sourceOffsetToPreviewTopSorted,
  buildSortedAnchorArrays,
  measureMdAnchorsInDom,
  shouldUpdateScrollTop,
  srcAttrs,
} from "@/lib/locate";
import type { SortedAnchorArrays } from "@/lib/locate/scrollSync";
import type { LocateResult } from "@/lib/locate";
import { rehypeSrcPositions } from "@/lib/locate/rehypeSrcPositions";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";
import { subscribeScrollSync } from "@/lib/locate/scrollBus";
import { probeRender, probeSection } from "@/lib/dev/perfProbe";
import { AssetImage } from "./editor/AssetImage";
import { InlineCodeFenceEditor } from "./editor/InlineCodeFenceEditor";
import { InlineMdBlockEditor } from "./editor/InlineMdBlockEditor";
import { InlineVisualBlockEditor } from "./editor/InlineVisualBlockEditor";
import {
  findEditableSrcBlock,
  findGapInsertAt,
  guessCursorInSlice,
  isClientYBelowLastSrcBlock,
  isMonoSrcSlice,
  listAnnotatedSrcBlocks,
  listGapHitRects,
  listGapSrcBlocks,
  normalizeAppendWriteText,
  plainOffsetInElement,
  prepareAppendAtEnd,
  prepareInsertBetween,
  replaceRange,
  type GapHitRect,
  type SrcBlockGeom,
} from "@/lib/mdInlineEdit";
import {
  classifyMdBlock,
  fenceBodyOffsetFromSliceOffset,
  isVisualEditableType,
  parseMarkdownFence,
  previewBlockEditMode,
  serializeVisualBlock,
  type VisualBlockType,
} from "@/lib/mdVisualSerialize";
import {
  isMergeBoundaryType,
  mergeVisualSlices,
  type SplitResult,
} from "@/lib/previewVisualCaret";

import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";


function isSourceMonoFallback(t: VisualBlockType): boolean {
  // table/callout/unknown stay on source textarea (safer than bad serialize).
  return t === "table" || t === "callout" || t === "unknown";
}

/** Hosts a mid-doc insert textarea immediately after the previous preview block. */
function InsertBetweenPortal({
  anchorEl,
  placeBefore = false,
  text,
  onChange,
  onCommit,
  onCancel,
  suppressBlurRef,
  onBlurCommit,
}: {
  anchorEl: HTMLElement;
  placeBefore?: boolean;
  text: string;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  suppressBlurRef: React.MutableRefObject<boolean>;
  onBlurCommit: () => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-lh-insert-host", "1");
    host.className = "lh-inline-insert-host";
    const parent = anchorEl.parentElement;
    if (!parent) return;
    if (placeBefore) {
      parent.insertBefore(host, anchorEl);
    } else if (anchorEl.nextSibling) {
      parent.insertBefore(host, anchorEl.nextSibling);
    } else {
      parent.appendChild(host);
    }
    hostRef.current = host;
    setReady(true);
    return () => {
      host.remove();
      hostRef.current = null;
    };
  }, [anchorEl, placeBefore]);

  if (!ready || !hostRef.current) return null;

  return createPortal(
    <div
      data-lh-inline-editor="1"
      className="lh-inline-edit-box my-3 rounded-md ring-1 ring-[var(--accent)]/40 bg-transparent px-1 py-1"
    >
      <textarea
        autoFocus
        data-lh-inline-editor="textarea"
        value={text}
        aria-label="在中间插入"
        placeholder="在此插入新段落…"
        className="w-full resize-none bg-transparent border-0 outline-none p-0 m-0 font-serif text-[length:inherit] leading-relaxed text-[var(--fg)] whitespace-pre-wrap placeholder:text-[var(--muted)]"
        style={{ minHeight: 32, fontSize: "inherit", lineHeight: "inherit" }}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          e.target.style.height = "0px";
          e.target.style.height = `${Math.max(e.target.scrollHeight, 32)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (suppressBlurRef.current) {
              suppressBlurRef.current = false;
              return;
            }
            onBlurCommit();
          }, 0);
        }}
      />
    </div>,
    hostRef.current
  );
}


function WikiText({ text, docs, onOpen }: { text: string; docs: Document[]; onOpen: (id: string) => void }) {
  const parts = text.split(/(!?\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^(!?)\[\[([^\]]+)\]\]$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const embed = m[1] === "!";
        const parsed = parseWikiInner(m[2]);
        if (embed) {
          return (
            <WikiEmbed
              key={i}
              target={parsed.target}
              heading={parsed.heading}
              docs={docs}
              onOpen={onOpen}
            />
          );
        }
        const label = wikiDisplayLabel(parsed);
        return (
          <WikiLink
            key={i}
            name={parsed.target}
            label={label}
            heading={parsed.heading}
            docs={docs}
            onOpen={onOpen}
          />
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

const MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

type MarkdownBodyProps = {
  body: string;
  fmOffset: number;
  fmLineOffset: number;
  documents: Document[];
  openDoc: (id: string) => void;
  assets: import("@/lib/types").AssetMeta[];
  docPath: string;
};

const MarkdownBody = React.memo(function MarkdownBody({
  body,
  fmOffset,
  fmLineOffset,
  documents,
  openDoc,
  assets,
  docPath,
}: MarkdownBodyProps) {
  probeRender("MarkdownBody");

  const rehypePlugins = React.useMemo(
    () => [
      rehypeKatex,
      rehypeSlug,
      rehypeRaw,
      // Bug 3: stamp data-src-* BEFORE sanitize/highlight drop positions.
      rehypeSrcPositions(fmOffset, fmLineOffset),
      [rehypeSanitize, mdSanitizeSchema] as [typeof rehypeSanitize, typeof mdSanitizeSchema],
      [rehypeHighlight, { plainText: ["mermaid"] }] as [typeof rehypeHighlight, { plainText: string[] }],
    ],
    [fmOffset, fmLineOffset]
  );

  const withSrc = (
    Tag: keyof React.JSX.IntrinsicElements,
    node: HastNode | undefined,
    props: Record<string, unknown>,
    children: React.ReactNode
  ) => {
    const hastProps = (node as { properties?: Record<string, unknown> } | undefined)?.properties;
    const fromHast =
      hastProps &&
      typeof hastProps["data-src-start"] === "number" &&
      typeof hastProps["data-src-end"] === "number"
        ? {
            "data-src-start": hastProps["data-src-start"] as number,
            "data-src-end": hastProps["data-src-end"] as number,
            ...(typeof hastProps["data-src-line"] === "number"
              ? { "data-src-line": hastProps["data-src-line"] as number }
              : {}),
          }
        : null;
    const fromProps =
      typeof props["data-src-start"] === "number" &&
      typeof props["data-src-end"] === "number"
        ? {
            "data-src-start": props["data-src-start"] as number,
            "data-src-end": props["data-src-end"] as number,
            ...(typeof props["data-src-line"] === "number"
              ? { "data-src-line": props["data-src-line"] as number }
              : {}),
          }
        : null;
    const attrs = fromHast || fromProps || srcAttrs(fmOffset, node);
    return React.createElement(Tag, { ...props, ...attrs }, children);
  };

  const components = React.useMemo(
    () => ({
      p: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) =>
        withSrc("p", node, props, walkChildren(children, documents, openDoc)),
      li: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) =>
        withSrc("li", node, props, walkChildren(children, documents, openDoc)),
      td: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) =>
        withSrc("td", node, props, walkChildren(children, documents, openDoc)),
      th: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) =>
        withSrc("th", node, props, walkChildren(children, documents, openDoc)),
      tr: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) =>
        withSrc("tr", node, props, children),
      blockquote: ({ node, children, ...props }: { node?: HastNode; children?: React.ReactNode } & Record<string, unknown>) => {
        const { kind, title, rest } = calloutKindFromChildren(children);
        const attrs = srcAttrs(fmOffset, node);
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
      h1: ({ node, children, id, ...props }: { node?: HastNode; children?: React.ReactNode; id?: string } & Record<string, unknown>) =>
        withSrc(
          "h1",
          node,
          { ...(props as object), id } as Record<string, unknown>,
          walkChildren(children, documents, openDoc)
        ),
      h2: ({ node, children, id, ...props }: { node?: HastNode; children?: React.ReactNode; id?: string } & Record<string, unknown>) =>
        withSrc(
          "h2",
          node,
          { ...(props as object), id } as Record<string, unknown>,
          walkChildren(children, documents, openDoc)
        ),
      h3: ({ node, children, id, ...props }: { node?: HastNode; children?: React.ReactNode; id?: string } & Record<string, unknown>) =>
        withSrc(
          "h3",
          node,
          { ...(props as object), id } as Record<string, unknown>,
          walkChildren(children, documents, openDoc)
        ),
      pre: ({ node, children }: { node?: HastNode; children?: React.ReactNode }) => {
        void node;
        return <>{children}</>;
      },
      code: ({ node, className, children, ...props }: { node?: HastNode; className?: string; children?: React.ReactNode; inline?: boolean } & Record<string, unknown>) => {
        const inline = props.inline;
        const isBlock =
          inline === false ||
          (typeof className === "string" && /(^|\s)language-/.test(className));
        const attrs = srcAttrs(fmOffset, node);
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
      img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => {
        const resolved = resolveMediaSrc(src, docPath, documents, assets);
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
        if (resolved.kind === "asset") {
          return (
            <AssetImage
              assetId={resolved.assetId}
              path={resolved.path}
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
      a: ({ href, children, ...props }: { href?: string; children?: React.ReactNode } & Record<string, unknown>) => {
        const resolved = resolveLibraryHref(href, docPath, documents);
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
      div: ({ className, children, ...props }: { className?: string; children?: React.ReactNode } & Record<string, unknown>) => {
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
    }),
    // withSrc closes over fmOffset; documents/openDoc/assets/docPath used in handlers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fmOffset, documents, openDoc, assets, docPath]
  );

  return (
    <ReactMarkdown
      remarkPlugins={MD_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins as never}
      components={components as never}
    >
      {body}
    </ReactMarkdown>
  );
});

/** Absolute hit strips between annotated blocks (collapsed HTML whitespace). */
function PreviewGapHitLayer({
  articleRef,
  bodyKey,
  enabled,
}: {
  articleRef: React.RefObject<HTMLElement | null>;
  bodyKey: string;
  enabled: boolean;
}) {
  const [hits, setHits] = React.useState<GapHitRect[]>([]);

  React.useLayoutEffect(() => {
    if (!enabled) {
      setHits([]);
      return;
    }
    const article = articleRef.current;
    if (!article) return;

    const measure = () => {
      const header = article.querySelector("header");
      const topBound = header
        ? header.getBoundingClientRect().bottom
        : article.getBoundingClientRect().top;
      setHits(listGapHitRects(article, { topBoundClientY: topBound, minHitPx: 14 }));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(article);
    const scroll = document.getElementById("reader-scroll");
    scroll?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      scroll?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [articleRef, bodyKey, enabled]);

  if (!enabled || hits.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-[1]"
      aria-hidden
    >
      {hits.map((h, i) => (
        <div
          key={`${h.insertAt}-${h.placeBefore ? "b" : "a"}-${i}`}
          data-lh-gap-hit="1"
          data-lh-gap-insert-at={h.insertAt}
          data-lh-gap-before={h.placeBefore ? "1" : undefined}
          data-lh-gap-anchor-start={h.anchorEl.getAttribute("data-src-start") || ""}
          className="pointer-events-auto absolute cursor-text rounded-sm transition-colors hover:bg-[var(--accent)]/8"
          style={{
            top: h.top,
            left: h.left,
            width: h.width,
            height: h.height,
          }}
          title="点击继续编辑"
        />
      ))}
    </div>
  );
}


export function MarkdownReader({ doc }: { doc: Document }) {
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const setDocTags = useStore((s) => s.setDocTags);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const pendingPreviewLocate = useStore((s) => s.pendingPreviewLocate);
  const clearPendingPreviewLocate = useStore((s) => s.clearPendingPreviewLocate);
  const setStatus = useStore((s) => s.setStatus);
  const publishScrollSync = useStore((s) => s.publishScrollSync);
  const getSyncScrollEnabled = useStore((s) => s.getSyncScrollEnabled);
  const outlineRailOpen = useStore((s) => s.outlineRailOpen);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const assets = useStore((s) => s.assets);
  const assetsForDoc = useStore((s) => s.assetsForDoc);
  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const ingestImageFile = useStore((s) => s.ingestImageFile);
  const setDraft = useStore((s) => s.setDraft);
  const pushPreviewUndo = useStore((s) => s.pushPreviewUndo);
  const saveDoc = useStore((s) => s.saveDoc);
  const viewMode = useStore((s) => s.viewMode);
  const wide = useMediaQuery("(min-width: 1280px)");
  probeRender("MarkdownReader");
  const content = getContent(doc.id);
  const fmOffset = React.useMemo(() => frontmatterOffset(content), [content]);
  const fmLineOffset = React.useMemo(() => frontmatterLineOffset(content), [content]);
  const body = React.useMemo(() => parseFrontmatter(content).body, [content]);
  const tags = React.useMemo(() => getTags({ ...doc, content }), [doc, content]);
  const words = React.useMemo(() => countWords(body), [body]);
  const outline = React.useMemo(() => extractOutline(content), [content]);
  const backlinks = React.useMemo(() => findBacklinks(documents, doc), [documents, doc]);
  const [activeHeading, setActiveHeading] = React.useState<string>("");
  const [tagInput, setTagInput] = React.useState("");
  const articleRef = React.useRef<HTMLElement>(null);
  const ignoreScrollUntil = React.useRef(0);
  const machineDrive = React.useRef<"preview" | "editor" | null>(null);
  const resetTimer = React.useRef<number | null>(null);
  /** Cached sorted anchor arrays; invalidated on body/layout/fonts changes. */
  const anchorsCacheRef = React.useRef<SortedAnchorArrays | null>(null);
  const anchorsInvalidateRaf = React.useRef(0);
  /** Heading content tops; same invalidate schedule as anchors. */
  const headingTopsCacheRef = React.useRef<HeadingContentTop[] | null>(null);
  const [previewFlash, setPreviewFlash] = React.useState<HTMLElement | null>(null);
  const [menu, setMenu] = React.useState<{
    x: number;
    y: number;
    srcStart?: number;
    srcEnd?: number;
    srcLine?: number;
  } | null>(null);

  type InlineEditState =
    | {
        kind: "block";
        mode: "visual" | "code" | "source";
        blockType: VisualBlockType;
        start: number;
        end: number;
        /** Draft text for source mode; for visual = original slice until commit. */
        text: string;
        mono: boolean;
        cursorAt: number;
        el: HTMLElement;
        clientX?: number;
        clientY?: number;
        /** Visual caret when reopening (split/merge/nav/gap). */
        caretAt?: "start" | "end" | number;
      }
    | {
        kind: "append";
        start: number;
        end: number;
        text: string;
        mono: boolean;
        cursorAt: number;
      }
    | {
        kind: "insert";
        /** Source offset after the previous block (data-src-end), or first.start when placeBefore. */
        insertAt: number;
        text: string;
        mono: boolean;
        cursorAt: number;
        /** Previous block element — portal host for the insert editor. */
        anchorEl: HTMLElement;
        /** Place insert editor before anchor (before first block). */
        placeBefore?: boolean;
      };
  const [inlineEdit, setInlineEdit] = React.useState<InlineEditState | null>(null);
  const inlineEditRef = React.useRef<InlineEditState | null>(null);
  inlineEditRef.current = inlineEdit;
  const suppressBlurCommitRef = React.useRef(false);
  const scrollRestoreRef = React.useRef<number | null>(null);
  const pendingOpenRef = React.useRef<{
    start: number;
    end: number;
    text: string;
    mono: boolean;
    cursorAt: number;
    mode?: "visual" | "code" | "source";
    blockType?: VisualBlockType;
    clientX?: number;
    clientY?: number;
    caretAt?: "start" | "end" | number;
  } | null>(null);
  /** Bumped when openNext is queued without a body rewrite (empty append/insert). */
  const [pendingOpenTick, setPendingOpenTick] = React.useState(0);

  // Outline scroll-spy: cached content tops; scroll only does math (no layout reads).
  React.useEffect(() => {
    const root = document.getElementById("reader-scroll");
    if (!root) return;
    let raf = 0;
    const ensureHeads = () => {
      if (headingTopsCacheRef.current) return headingTopsCacheRef.current;
      const scope = articleRef.current ?? root;
      const measured = measureHeadingContentTops(root, scope);
      headingTopsCacheRef.current = measured;
      return measured;
    };
    const update = () => {
      raf = 0;
      const cached = ensureHeads();
      const rootTop = root.getBoundingClientRect().top;
      const heads = headingViewportTops(cached, root.scrollTop, rootTop);
      const current = resolveActiveHeadingId(heads, OUTLINE_SPY_THRESHOLD_PX);
      setActiveHeading((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [body, outline.length]);

  const runLocate = React.useCallback((opts?: { select?: boolean; focus?: boolean }) => {
    const root = articleRef.current;
    if (!root) return;
    const info = getPreviewSelectionInfo(root);
    if (!info || isTrivialSelection(info.text)) {
      setStatus("请先选中一段文字");
      setMenu(null);
      return;
    }
    let result = locateInMarkdown({
      source: content,
      selectedText: info.text,
      startBlock: info.startBlock,
      endBlock: info.endBlock,
      anchorPlainOffset: info.anchorPlainOffset,
    });
    const select = opts?.select ?? true;
    const focus = opts?.focus ?? select;
    if (result.precision !== "none") {
      const a = lineAtOffset(content, result.start);
      const b = lineAtOffset(content, result.end > result.start ? result.end - 1 : result.end);
      result = {
        ...result,
        message:
          a === b
            ? `已选中第 ${a} 行，可直接编辑`
            : `已选中第 ${a}–${b} 行，可直接编辑`,
      };
    }
    applyLocateResult(result, { select, focus, highlight: true });
    setMenu(null);
  }, [content, applyLocateResult, setStatus]);

  const captureScroll = React.useCallback(() => {
    const root = document.getElementById("reader-scroll");
    scrollRestoreRef.current = root ? root.scrollTop : null;
  }, []);

  const commitInlineEdit = React.useCallback(
    (opts?: {
      text?: string;
      openNext?: {
        start: number;
        end: number;
        text: string;
        mono: boolean;
        cursorAt: number;
        mode?: "visual" | "code" | "source";
        blockType?: VisualBlockType;
        clientX?: number;
        clientY?: number;
        caretAt?: "start" | "end" | number;
        /** start/end already absolute inside the new writeText. */
        inReplacement?: boolean;
      };
    }) => {
      const ed = inlineEditRef.current;
      // Blur after an already-committed switch: keep pendingOpenRef intact.
      if (!ed) {
        if (opts?.openNext) pendingOpenRef.current = opts.openNext;
        return;
      }
      const cur = getContent(doc.id);

      // Append: compute EOF range at commit time so Esc/empty blur does not dirty the doc.
      if (ed.kind === "append") {
        const writeText = normalizeAppendWriteText(opts?.text ?? ed.text);
        if (!writeText) {
          if (opts?.openNext) {
            pendingOpenRef.current = opts.openNext;
            setPendingOpenTick((n) => n + 1);
          }
          setInlineEdit(null);
          return;
        }
        const { prepared, start, end } = prepareAppendAtEnd(cur);
        const after = replaceRange(prepared, start, end, writeText);
        captureScroll();
        if (after !== cur) {
          pushPreviewUndo(doc.id, cur);
          setDraft(doc.id, after);
        }
        if (opts?.openNext) {
          pendingOpenRef.current = opts.openNext;
          if (after === cur) setPendingOpenTick((n) => n + 1);
        }
        setInlineEdit(null);
        return;
      }

      // Mid-doc gap insert (between annotated blocks) via replaceRange only.
      if (ed.kind === "insert") {
        const writeText = normalizeAppendWriteText(opts?.text ?? ed.text);
        if (!writeText) {
          if (opts?.openNext) {
            pendingOpenRef.current = opts.openNext;
            setPendingOpenTick((n) => n + 1);
          }
          setInlineEdit(null);
          return;
        }
        const { prepared, start, end } = prepareInsertBetween(cur, ed.insertAt);
        const after = replaceRange(prepared, start, end, writeText);
        captureScroll();
        if (after !== cur) {
          pushPreviewUndo(doc.id, cur);
          setDraft(doc.id, after);
        }
        if (opts?.openNext) {
          pendingOpenRef.current = opts.openNext;
          if (after === cur) setPendingOpenTick((n) => n + 1);
        }
        setInlineEdit(null);
        return;
      }

      let writeText = opts?.text ?? ed.text;
      if (
        opts?.text == null &&
        ed.kind === "block" &&
        ed.mode === "visual"
      ) {
        writeText = serializeVisualBlock({
          originalSlice: ed.text,
          blockType: ed.blockType,
          element: ed.el,
        });
      }
      const after = replaceRange(cur, ed.start, ed.end, writeText);
      captureScroll();
      if (after !== cur) {
        pushPreviewUndo(doc.id, cur);
        setDraft(doc.id, after);
      }
      if (opts?.openNext) {
        let { start, end, text } = opts.openNext;
        const {
          mono,
          cursorAt,
          mode,
          blockType,
          clientX,
          clientY,
          caretAt,
          inReplacement,
        } = opts.openNext;
        const delta = after.length - cur.length;
        const writeLen = writeText.length;
        if (inReplacement) {
          // Coordinates already absolute inside the new replacement at ed.start.
          start = Math.max(ed.start, Math.min(start, ed.start + writeLen));
          end = Math.max(start, Math.min(end, ed.start + writeLen));
          text = after.slice(start, end);
        } else if (start >= ed.end) {
          start += delta;
          end += delta;
          text = after.slice(start, end);
        } else if (end <= ed.start) {
          text = after.slice(start, end);
        } else {
          pendingOpenRef.current = null;
          setInlineEdit(null);
          return;
        }
        pendingOpenRef.current = {
          start,
          end,
          text,
          mono,
          cursorAt,
          mode,
          blockType,
          clientX,
          clientY,
          caretAt,
        };
      }
      setInlineEdit(null);
    },
    [captureScroll, doc.id, getContent, pushPreviewUndo, setDraft]
  );

  const cancelInlineEdit = React.useCallback(() => {
    suppressBlurCommitRef.current = true;
    pendingOpenRef.current = null;
    setInlineEdit(null);
  }, []);

  const beginBlockEdit = React.useCallback(
    (
      el: HTMLElement,
      start: number,
      end: number,
      click?: {
        clientX?: number;
        clientY?: number;
        caretAt?: "start" | "end" | number;
      }
    ) => {
      const cur = getContent(doc.id);
      const slice = cur.slice(start, end);
      const blockType = classifyMdBlock(slice);
      const mono = isMonoSrcSlice(slice) || isSourceMonoFallback(blockType);
      const mode = previewBlockEditMode(blockType, mono);
      // For code fences, place caret in body using pre/code text (not chrome/gutter).
      let cursorAt = 0;
      if (mode === "code") {
        const parsed = parseMarkdownFence(slice);
        const body = parsed?.body ?? "";
        if (typeof click?.caretAt === "number") {
          cursorAt = parsed
            ? fenceBodyOffsetFromSliceOffset(parsed, click.caretAt)
            : Math.max(0, Math.min(click.caretAt, body.length));
        } else if (click?.caretAt === "start") {
          cursorAt = 0;
        } else if (click?.caretAt === "end") {
          cursorAt = body.length;
        } else {
          const codeEl =
            el.querySelector<HTMLElement>("pre code") ||
            el.querySelector<HTMLElement>("pre") ||
            el;
          const hint =
            click && click.clientX != null && click.clientY != null
              ? plainOffsetInElement(codeEl, click.clientX, click.clientY)
              : null;
          cursorAt = guessCursorInSlice(body, {
            clickText: hint?.clickText,
            approxOffset: hint?.approxOffset,
          });
        }
      } else {
        const hint =
          click && click.clientX != null && click.clientY != null
            ? plainOffsetInElement(el, click.clientX, click.clientY)
            : null;
        cursorAt =
          typeof click?.caretAt === "number"
            ? click.caretAt
            : click?.caretAt === "start"
              ? 0
              : click?.caretAt === "end"
                ? slice.length
                : guessCursorInSlice(slice, {
                    clickText: hint?.clickText,
                    approxOffset: hint?.approxOffset,
                  });
      }
      // Heavy mono (mermaid/math/table/callout) keep status; plain code does not.
      if (mode === "source") {
        setStatus("此块需编辑源码");
      }
      setInlineEdit({
        kind: "block",
        mode,
        blockType,
        start,
        end,
        text: slice,
        mono,
        cursorAt,
        el,
        clientX: click?.clientX,
        clientY: click?.clientY,
        caretAt: click?.caretAt,
      });
    },
    [doc.id, getContent, setStatus]
  );

  const beginAppendEdit = React.useCallback(() => {
    // Offsets are computed in commitInlineEdit via prepareAppendAtEnd.
    setInlineEdit({
      kind: "append",
      start: 0,
      end: 0,
      text: "",
      mono: false,
      cursorAt: 0,
    });
  }, []);

  const beginInsertBetween = React.useCallback(
    (insertAt: number, anchorEl: HTMLElement, placeBefore = false) => {
      setInlineEdit({
        kind: "insert",
        insertAt,
        text: "",
        mono: false,
        cursorAt: 0,
        anchorEl,
        placeBefore,
      });
    },
    []
  );

  /** Top-level annotated blocks with classify + visual flag. */
  const describeSrcBlocks = React.useCallback(
    (root: ParentNode, source: string) => {
      return listAnnotatedSrcBlocks(root).map((b) => {
        const slice = source.slice(b.start, b.end);
        const blockType = classifyMdBlock(slice);
        const mono = isMonoSrcSlice(slice) || isSourceMonoFallback(blockType);
        const visual = isVisualEditableType(blockType) && !mono;
        return { ...b, slice, blockType, mono, visual };
      });
    },
    []
  );

  const openNextForRange = React.useCallback(
    (
      source: string,
      start: number,
      end: number,
      caretAt: "start" | "end" | number = "start"
    ) => {
      const slice = source.slice(start, end);
      const blockType = classifyMdBlock(slice);
      const mono = isMonoSrcSlice(slice) || isSourceMonoFallback(blockType);
      const mode = previewBlockEditMode(blockType, mono);
      let cursorAt =
        typeof caretAt === "number"
          ? caretAt
          : caretAt === "end"
            ? slice.length
            : 0;
      if (mode === "code") {
        const parsed = parseMarkdownFence(slice);
        const bodyLen = parsed?.body.length ?? 0;
        if (typeof caretAt === "number") {
          cursorAt = parsed
            ? fenceBodyOffsetFromSliceOffset(parsed, caretAt)
            : Math.max(0, Math.min(caretAt, bodyLen));
        } else {
          cursorAt = caretAt === "end" ? bodyLen : 0;
        }
      }
      return {
        start,
        end,
        text: slice,
        mono,
        cursorAt,
        mode,
        blockType,
        caretAt,
      };
    },
    []
  );

  /** Gap click → activate neighbor visual/source block (no insert textarea). */
  const activateGapNeighbor = React.useCallback(
    (
      root: HTMLElement,
      opts: {
        placeBefore: boolean;
        prev?: SrcBlockGeom | null;
        next?: SrcBlockGeom | null;
        prefer?: "prev" | "next";
      }
    ) => {
      const prefer = opts.prefer ?? (opts.placeBefore ? "next" : "prev");
      const target =
        prefer === "prev"
          ? opts.prev || opts.next
          : opts.next || opts.prev;
      if (!target) {
        beginAppendEdit();
        return;
      }
      // placeBefore / prefer next → start; prefer prev → end
      const at: "start" | "end" = opts.placeBefore
        ? "start"
        : prefer === "next"
          ? "start"
          : "end";
      if (inlineEditRef.current) {
        suppressBlurCommitRef.current = true;
        commitInlineEdit({
          openNext: openNextForRange(
            getContent(doc.id),
            target.start,
            target.end,
            at
          ),
        });
        return;
      }
      beginBlockEdit(target.el, target.start, target.end, { caretAt: at });
    },
    [beginAppendEdit, beginBlockEdit, commitInlineEdit, doc.id, getContent, openNextForRange]
  );

  const handleVisualSplit = React.useCallback(
    (result: SplitResult, _serialized: string) => {
      const ed = inlineEditRef.current;
      if (!ed || ed.kind !== "block") return false;
      if (result.kind === "delete") {
        const root = articleRef.current;
        const cur = getContent(doc.id);
        const blocks = root ? describeSrcBlocks(root, cur) : [];
        const idx = blocks.findIndex(
          (b) => b.start === ed.start && b.end === ed.end
        );
        const prev = idx > 0 ? blocks[idx - 1] : null;
        const next = idx >= 0 && idx < blocks.length - 1 ? blocks[idx + 1] : null;
        // Prefer previous visual at end; else next at start.
        let openNext = undefined as ReturnType<typeof openNextForRange> | undefined;
        if (prev && prev.visual) {
          openNext = openNextForRange(cur, prev.start, prev.end, "end");
        } else if (next) {
          // next offsets still valid after delete? delete shrinks — next has start >= ed.end
          openNext = {
            ...openNextForRange(cur, next.start, next.end, "start"),
            // will get delta in commit because start >= ed.end
          };
        }
        commitInlineEdit({ text: "", openNext });
        return true;
      }
      const absStart = ed.start + result.nextLocalStart;
      const absEnd = ed.start + result.nextLocalEnd;
      const nextSlice = result.writeText.slice(
        result.nextLocalStart,
        result.nextLocalEnd
      );
      const nextType = result.nextBlockType;
      const nextMono =
        isMonoSrcSlice(nextSlice) || isSourceMonoFallback(nextType);
      commitInlineEdit({
        text: result.writeText,
        openNext: {
          start: absStart,
          end: absEnd,
          text: nextSlice,
          mono: nextMono,
          cursorAt: 0,
          mode: previewBlockEditMode(nextType, nextMono),
          blockType: nextType,
          caretAt: "start",
          inReplacement: true,
        },
      });
      return true;
    },
    [commitInlineEdit, describeSrcBlocks, doc.id, getContent, openNextForRange]
  );

  const handleVisualMergePrev = React.useCallback(
    (serialized: string) => {
      const ed = inlineEditRef.current;
      if (!ed || ed.kind !== "block") return false;
      const root = articleRef.current;
      if (!root) return false;
      const cur = getContent(doc.id);
      const blocks = describeSrcBlocks(root, cur);
      const idx = blocks.findIndex(
        (b) => b.start === ed.start && b.end === ed.end
      );
      if (idx <= 0) return false;
      const prev = blocks[idx - 1]!;
      if (isMergeBoundaryType(prev.blockType) || !prev.visual) {
        // Stop at boundary — do not swallow code/mermaid/math/table/callout.
        return true;
      }
      const merged = mergeVisualSlices({
        prevSlice: prev.slice,
        nextSlice: serialized,
        prevType: prev.blockType,
        nextType: ed.blockType,
      });
      if (!merged) return true;
      // Temporarily expand edit range to cover prev+current for replaceRange.
      inlineEditRef.current = {
        ...ed,
        start: prev.start,
        end: ed.end,
        text: cur.slice(prev.start, ed.end),
        el: prev.el,
        blockType: prev.blockType,
        mode: "visual",
        mono: false,
      };
      commitInlineEdit({
        text: merged.writeText,
        openNext: {
          start: prev.start,
          end: prev.start + merged.writeText.length,
          text: merged.writeText,
          mono: false,
          cursorAt: merged.caretPlain,
          mode: "visual",
          blockType: prev.blockType,
          caretAt: merged.caretPlain,
          inReplacement: true,
        },
      });
      return true;
    },
    [commitInlineEdit, describeSrcBlocks, doc.id, getContent]
  );

  const handleVisualNavigate = React.useCallback(
    (dir: "prev" | "next", serialized: string) => {
      const ed = inlineEditRef.current;
      if (!ed || ed.kind !== "block") return false;
      const root = articleRef.current;
      if (!root) return false;
      const cur = getContent(doc.id);
      const blocks = describeSrcBlocks(root, cur);
      const idx = blocks.findIndex(
        (b) => b.start === ed.start && b.end === ed.end
      );
      if (idx < 0) return false;
      const targetIdx = dir === "prev" ? idx - 1 : idx + 1;
      // Skip to nearest visual block; if next is source-type, still open it (source editor).
      if (targetIdx < 0 || targetIdx >= blocks.length) return false;
      const target = blocks[targetIdx]!;
      // Prefer visual neighbors for seamless caret; source blocks still openable.
      const caretAt: "start" | "end" = dir === "prev" ? "end" : "start";
      commitInlineEdit({
        text: serialized,
        openNext: openNextForRange(cur, target.start, target.end, caretAt),
      });
      return true;
    },
    [commitInlineEdit, describeSrcBlocks, doc.id, getContent, openNextForRange]
  );

  // Restore scroll after content rewrite from inline edit; open pending block/append.
  React.useLayoutEffect(() => {
    if (scrollRestoreRef.current != null) {
      const root = document.getElementById("reader-scroll");
      if (root) root.scrollTop = scrollRestoreRef.current;
      scrollRestoreRef.current = null;
    }
    const pending = pendingOpenRef.current;
    if (!pending) return;
    pendingOpenRef.current = null;
    const article = articleRef.current;
    if (!article) return;
    if (pending.start === pending.end) {
      setInlineEdit({
        kind: "append",
        start: pending.start,
        end: pending.end,
        text: pending.text,
        mono: pending.mono,
        cursorAt: pending.cursorAt,
      });
      return;
    }
    const nodes = [
      ...article.querySelectorAll<HTMLElement>("[data-src-start]"),
    ];
    let el =
      nodes.find(
        (n) =>
          Number(n.getAttribute("data-src-start")) === pending.start &&
          Number(n.getAttribute("data-src-end") || 0) === pending.end
      ) ?? null;
    if (!el) {
      // Prefer outer wrapper with same start
      el =
        nodes.find(
          (n) => Number(n.getAttribute("data-src-start")) === pending.start
        ) ?? null;
    }
    if (!el) {
      setInlineEdit({
        kind: "append",
        start: pending.start,
        end: pending.end,
        text: pending.text,
        mono: pending.mono,
        cursorAt: pending.cursorAt,
      });
      return;
    }
    const wrap = el.closest(".lh-codeblock, .lh-mermaid");
    if (wrap instanceof HTMLElement && wrap.hasAttribute("data-src-start")) {
      el = wrap;
    }
    const end = Number(el.getAttribute("data-src-end") || pending.end);
    const blockType = pending.blockType ?? classifyMdBlock(pending.text);
    const mode =
      pending.mode ??
      previewBlockEditMode(blockType, pending.mono);
    setInlineEdit({
      kind: "block",
      mode,
      blockType,
      start: pending.start,
      end,
      text: pending.text,
      mono: pending.mono,
      cursorAt: pending.cursorAt,
      el,
      clientX: pending.clientX,
      clientY: pending.clientY,
      caretAt: pending.caretAt,
    });
  }, [body, pendingOpenTick]);

  const invalidateAnchorCache = React.useCallback(() => {
    anchorsCacheRef.current = null;
    headingTopsCacheRef.current = null;
  }, []);

  const ensureSortedAnchors = React.useCallback((): SortedAnchorArrays | null => {
    if (anchorsCacheRef.current) return anchorsCacheRef.current;
    return probeSection("measureMdAnchors", () => {
      const root = document.getElementById("reader-scroll");
      const article = articleRef.current;
      if (!root || !article) return null;
      const anchors = measureMdAnchorsInDom(root, article);
      const sorted = buildSortedAnchorArrays(anchors);
      anchorsCacheRef.current = sorted;
      return sorted;
    });
  }, []);

  // Invalidate anchor cache when body changes, container resizes, or fonts load.
  React.useEffect(() => {
    invalidateAnchorCache();
  }, [body, invalidateAnchorCache]);

  React.useEffect(() => {
    const root = document.getElementById("reader-scroll");
    const article = articleRef.current;
    if (!root && !article) return;
    const schedule = () => {
      if (anchorsInvalidateRaf.current) return;
      anchorsInvalidateRaf.current = requestAnimationFrame(() => {
        anchorsInvalidateRaf.current = 0;
        invalidateAnchorCache();
      });
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro && root) ro.observe(root);
    if (ro && article) ro.observe(article);
    let fontsGone = false;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) {
      void fonts.ready.then(() => {
        if (!fontsGone) invalidateAnchorCache();
      });
    }
    return () => {
      fontsGone = true;
      ro?.disconnect();
      if (anchorsInvalidateRaf.current) {
        cancelAnimationFrame(anchorsInvalidateRaf.current);
        anchorsInvalidateRaf.current = 0;
      }
    };
  }, [body, invalidateAnchorCache]);

  // Preview scroll → editor (cached anchors; binary search only — no layout reads)
  React.useEffect(() => {
    const root = document.getElementById("reader-scroll");
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        probeSection("previewScrollFrame", () => {
          const now = Date.now();
          if (now < ignoreScrollUntil.current) return;
          if (!getSyncScrollEnabled(doc.id)) return;
          if (useStore.getState().viewMode !== "split") return;
          if (machineDrive.current === "editor") return;
          machineDrive.current = "preview";
          if (resetTimer.current) window.clearTimeout(resetTimer.current);
          resetTimer.current = window.setTimeout(() => {
            machineDrive.current = null;
          }, 150);
          const sorted = ensureSortedAnchors();
          if (!sorted) return;
          const offset = previewTopToSourceOffsetSorted(
            root.scrollTop,
            sorted.previewTops,
            sorted.startsByPreview
          );
          if (offset == null) return;
          publishScrollSync({
            docId: doc.id,
            from: "preview",
            sourceOffset: offset,
          });
        });
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [doc.id, getSyncScrollEnabled, ensureSortedAnchors, publishScrollSync, body]);

  // Editor → preview scroll (bus; cached anchors)
  React.useEffect(() => {
    return subscribeScrollSync((ev) => {
      if (ev.docId !== doc.id) return;
      if (ev.from !== "editor") return;
      if (!getSyncScrollEnabled(doc.id)) return;
      if (useStore.getState().viewMode !== "split") return;
      const root = document.getElementById("reader-scroll");
      if (!root) return;
      if (machineDrive.current === "preview") return;
      machineDrive.current = "editor";
      ignoreScrollUntil.current = Date.now() + 100;
      const sorted = ensureSortedAnchors();
      const so = ev.sourceOffset;
      if (!sorted || so == null || !Number.isFinite(so)) return;
      const top = sourceOffsetToPreviewTopSorted(
        so,
        sorted.starts,
        sorted.previewTopsByStart
      );
      if (top != null && shouldUpdateScrollTop(root.scrollTop, top)) {
        root.scrollTop = top;
      }
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        machineDrive.current = null;
      }, 150);
    });
  }, [doc.id, getSyncScrollEnabled, ensureSortedAnchors]);

  // Click: split → locate; preview → inline edit (offset slice).
  React.useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      if (e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Inside active visual/source editor chrome: ignore (caret / typing).
      // Visual CE runs on an *isolated clone* (not cur.el); match by marker.
      const editingHost = t.closest("[data-lh-inline-editor], [contenteditable=true]");
      if (editingHost && inlineEditRef.current?.kind === "block") {
        return;
      }
      if (t.closest("a, button, input, textarea, summary")) return;
      const mode = useStore.getState().viewMode;

      // Ignore pure text-selection clicks (keep划词/批注), unless double-click.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim() && e.detail < 2) return;

      if (mode === "preview") {
        // Explicit continue-writing hit zone (padding below body).
        const onAppendZone = !!(t.closest("[data-lh-append-zone]"));
        const gapHit = t.closest<HTMLElement>("[data-lh-gap-hit]");
        if (gapHit && !onAppendZone) {
          const placeBefore = gapHit.getAttribute("data-lh-gap-before") === "1";
          const gaps = listGapSrcBlocks(root);
          if (placeBefore && gaps[0]) {
            activateGapNeighbor(root, {
              placeBefore: true,
              next: gaps[0],
              prefer: "next",
            });
            return;
          }
          const insertAt = Number(gapHit.getAttribute("data-lh-gap-insert-at"));
          if (Number.isFinite(insertAt)) {
            let prev: (typeof gaps)[number] | null = null;
            let next: (typeof gaps)[number] | null = null;
            for (let i = 0; i < gaps.length - 1; i++) {
              if (gaps[i]!.end === insertAt || gaps[i]!.end === insertAt) {
                prev = gaps[i]!;
                next = gaps[i + 1]!;
                break;
              }
            }
            if (!prev) {
              for (let i = 0; i < gaps.length - 1; i++) {
                if (Math.abs(gaps[i]!.end - insertAt) < 2) {
                  prev = gaps[i]!;
                  next = gaps[i + 1]!;
                  break;
                }
              }
            }
            // Mid-gap: upper half → prev end; lower → next start (via clientY later).
            // Hit layer has no clientY preference stored; use prev end (continue writing).
            activateGapNeighbor(root, {
              placeBefore: false,
              prev,
              next,
              prefer: "prev",
            });
            return;
          }
        }
        const found =
          onAppendZone || gapHit ? null : findEditableSrcBlock(t, root);
        if (!found) {
          // Empty doc, append zone, or click below the last block → append.
          // Click in the visual gap between two blocks → mid-doc insert.
          if (t.closest("header")) return;
          if (!onAppendZone) {
            const gap = findGapInsertAt(root, e.clientY);
            if (gap) {
              const mid = (gap.prev.bottom + gap.next.top) / 2;
              const prefer =
                gap.placeBefore
                  ? "next"
                  : e.clientY < mid
                    ? "prev"
                    : "next";
              activateGapNeighbor(root, {
                placeBefore: !!gap.placeBefore,
                prev: gap.prev,
                next: gap.next,
                prefer: prefer as "prev" | "next",
              });
              return;
            }
          }
          const below =
            onAppendZone || isClientYBelowLastSrcBlock(root, e.clientY);
          if (below) {
            if (inlineEditRef.current) {
              suppressBlurCommitRef.current = true;
              commitInlineEdit();
            }
            beginAppendEdit();
          }
          return;
        }
        const { el, start, end } = found;
        const cur = inlineEditRef.current;
        if (cur && cur.kind === "block" && cur.start === start && cur.end === end) {
          return;
        }
        if (cur) {
          suppressBlurCommitRef.current = true;
          const slice = getContent(doc.id).slice(start, end);
          const nextType = classifyMdBlock(slice);
          const nextMono =
            isMonoSrcSlice(slice) ||
            nextType === "table" ||
            nextType === "callout" ||
            nextType === "unknown";
          const nextMode = previewBlockEditMode(nextType, nextMono);
          let nextCursor = 0;
          if (nextMode === "code") {
            const parsed = parseMarkdownFence(slice);
            const body = parsed?.body ?? "";
            const codeEl =
              el.querySelector<HTMLElement>("pre code") ||
              el.querySelector<HTMLElement>("pre") ||
              el;
            nextCursor = guessCursorInSlice(
              body,
              plainOffsetInElement(codeEl, e.clientX, e.clientY) ?? undefined
            );
          } else {
            nextCursor = guessCursorInSlice(
              slice,
              plainOffsetInElement(el, e.clientX, e.clientY) ?? undefined
            );
          }
          commitInlineEdit({
            openNext: {
              start,
              end,
              text: slice,
              mono: nextMono,
              cursorAt: nextCursor,
              mode: nextMode,
              blockType: nextType,
              clientX: e.clientX,
              clientY: e.clientY,
            },
          });
          return;
        }
        beginBlockEdit(el, start, end, {
          clientX: e.clientX,
          clientY: e.clientY,
        });
        return;
      }

      // split / source-adjacent: locate as before
      const el = t.closest<HTMLElement>("[data-src-start]");
      if (!el) return;
      const start = Number(el.getAttribute("data-src-start"));
      const end = Number(el.getAttribute("data-src-end") || start);
      if (!Number.isFinite(start)) return;
      const line = Number(
        el.getAttribute("data-src-line") ||
          content.slice(0, start).split("\n").length
      );
      const isCodeLine = el.tagName === "SPAN" && el.hasAttribute("data-src-line");
      const result: LocateResult = {
        start,
        end,
        precision: isCodeLine ? "exact" : "block",
        line,
        message: isCodeLine
          ? `已定位到第 ${line} 行`
          : `已定位到所在段落（第 ${line} 行）`,
      };
      const select = !!(e.metaKey || e.ctrlKey || e.detail >= 2);
      applyLocateResult(result, { select, focus: select, highlight: true });
      el.classList.add("lh-preview-flash");
      window.setTimeout(() => el.classList.remove("lh-preview-flash"), 1200);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [
    content,
    applyLocateResult,
    body,
    activateGapNeighbor,
    beginAppendEdit,
    beginBlockEdit,
    commitInlineEdit,
    doc.id,
    getContent,
  ]);

  // Clicks on #reader-scroll chrome below the article (outside <article>) also append.
  React.useEffect(() => {
    const scroll = document.getElementById("reader-scroll");
    const article = articleRef.current;
    if (!scroll || !article) return;
    const onClick = (e: MouseEvent) => {
      if (e.altKey || e.shiftKey) return;
      if (useStore.getState().viewMode !== "preview") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (article.contains(t)) return; // article handler owns in-article clicks
      if (t.closest("a, button, input, textarea, summary, [role='dialog']")) return;
      if (t.closest("[data-lh-inline-editor]")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim() && e.detail < 2) return;
      if (!isClientYBelowLastSrcBlock(article, e.clientY)) return;
      if (inlineEditRef.current) {
        suppressBlurCommitRef.current = true;
        commitInlineEdit();
      }
      beginAppendEdit();
    };
    scroll.addEventListener("click", onClick);
    return () => scroll.removeEventListener("click", onClick);
  }, [beginAppendEdit, commitInlineEdit, body]);

  // 框选 alone does NOT auto-locate. User right-clicks → 「定位源码」 in context menu.

  // ⌘/Ctrl+Enter: commit inline edit when active; else locate source (existing).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || e.shiftKey) return;
      if (inlineEditRef.current) {
        e.preventDefault();
        suppressBlurCommitRef.current = true;
        commitInlineEdit();
        return;
      }
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
  }, [runLocate, commitInlineEdit]);

  // Preview: Enter edits the block under the caret / nearest block (no bare printable→edit).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (useStore.getState().viewMode !== "preview") return;
      if (inlineEditRef.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select, [contenteditable=true]") ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }
      const st = useStore.getState();
      if (
        st.commandOpen ||
        st.shortcutsDialogOpen ||
        st.exportDialogOpen ||
        st.backupDialogOpen ||
        st.versionDialogOpen ||
        st.graphDialogOpen ||
        st.propsDialogOpen ||
        st.clipUrlDialogOpen ||
        st.templateDialogOpen ||
        st.fsSyncDialogOpen ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }
      if (e.key !== "Enter" && e.key !== "e" && e.key !== "E") return;
      const root = articleRef.current;
      if (!root) return;
      // Prefer selection anchor block; else first visible block in viewport
      let el: HTMLElement | null = null;
      const sel = window.getSelection();
      if (sel && sel.anchorNode && root.contains(sel.anchorNode)) {
        const n =
          sel.anchorNode.nodeType === Node.ELEMENT_NODE
            ? (sel.anchorNode as HTMLElement)
            : sel.anchorNode.parentElement;
        const found = findEditableSrcBlock(n, root);
        if (found) el = found.el;
      }
      if (!el) {
        const scroll = document.getElementById("reader-scroll");
        const mid = (scroll?.scrollTop ?? 0) + (scroll?.clientHeight ?? 0) / 3;
        const blocks = [
          ...root.querySelectorAll<HTMLElement>("[data-src-start]"),
        ];
        for (const b of blocks) {
          if (b.classList.contains("lh-inline-edit-hidden")) continue;
          if (b.tagName === "SPAN" && b.hasAttribute("data-src-line")) continue;
          const top = b.offsetTop;
          if (top + b.offsetHeight >= mid) {
            el = b;
            break;
          }
        }
        if (!el && blocks.length) {
          el = blocks[blocks.length - 1] ?? null;
        }
      }
      if (!el) {
        if (e.key === "Enter") {
          e.preventDefault();
          beginAppendEdit();
        }
        return;
      }
      const found = findEditableSrcBlock(el, root);
      if (!found) return;
      e.preventDefault();
      beginBlockEdit(found.el, found.start, found.end);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [beginAppendEdit, beginBlockEdit]);

  // Source → Preview highlight. Caret follow flashes without scrolling unless
  // explicitly requested — scrolling would drive sync back into the editor.
  React.useEffect(() => {
    if (!pendingPreviewLocate) return;
    const root = articleRef.current;
    if (!root) {
      clearPendingPreviewLocate();
      return;
    }
    const offset = pendingPreviewLocate.offset;
    const wantScroll = pendingPreviewLocate.scroll === true;
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-src-start]")];
    let target: HTMLElement | null = null;
    let bestSpan = Infinity;
    for (const el of blocks) {
      const s = Number(el.getAttribute("data-src-start"));
      const e = Number(el.getAttribute("data-src-end"));
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) continue;
      if (offset < s || offset > e) continue;
      const span = e - s;
      if (span < bestSpan) {
        bestSpan = span;
        target = el;
      }
    }
    if (target) {
      ignoreScrollUntil.current = Date.now() + (wantScroll ? 350 : 200);
      machineDrive.current = "editor";
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        machineDrive.current = null;
      }, wantScroll ? 400 : 250);
      if (wantScroll) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      articleRef.current?.querySelectorAll(".lh-preview-flash").forEach((n) => n.classList.remove("lh-preview-flash"));
      target.classList.add("lh-preview-flash");
      setPreviewFlash(target);
      const flashTimer = window.setTimeout(() => {
        target?.classList.remove("lh-preview-flash");
        setPreviewFlash((cur) => (cur === target ? null : cur));
      }, 1600);
      clearPendingPreviewLocate();
      return () => clearTimeout(flashTimer);
    }
    clearPendingPreviewLocate();
  }, [pendingPreviewLocate, clearPendingPreviewLocate, body]);

  const summary = body.replace(/^#.+$/m, "").replace(/\s+/g, " ").trim().slice(0, 80);

  const onContextMenu = (e: React.MouseEvent) => {
    const root = articleRef.current;
    if (!root) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("[data-lh-inline-editor]")) {
      // Native menu inside the editor
      return;
    }
    const info = getPreviewSelectionInfo(root);
    const hasSel = !!(info && !isTrivialSelection(info.text));
    const target = e.target as HTMLElement | null;
    const srcEl = target?.closest?.<HTMLElement>("[data-src-start]");
    if (!hasSel && !srcEl) {
      // allow default menu
      return;
    }
    e.preventDefault();
    const srcStart = srcEl ? Number(srcEl.getAttribute("data-src-start")) : undefined;
    const srcEnd = srcEl ? Number(srcEl.getAttribute("data-src-end") || srcStart) : undefined;
    const srcLine = srcEl ? Number(srcEl.getAttribute("data-src-line") || 1) : undefined;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      srcStart: Number.isFinite(srcStart) ? srcStart : undefined,
      srcEnd: Number.isFinite(srcEnd) ? srcEnd : undefined,
      srcLine: Number.isFinite(srcLine) ? srcLine : undefined,
    });
  };

  const menuItems = React.useMemo((): ContextMenuItem[] => {
    const root = articleRef.current;
    const info = root ? getPreviewSelectionInfo(root) : null;
    const text = info?.text ?? "";
    return [
      {
        id: "locate",
        label: "定位源码",
        shortcut: "⌘↵",
        onSelect: () => {
          const root = articleRef.current;
          const info = root ? getPreviewSelectionInfo(root) : null;
          if (info && !isTrivialSelection(info.text)) {
            runLocate({ select: true, focus: true });
            return;
          }
          if (menu && menu.srcStart != null && Number.isFinite(menu.srcStart)) {
            const start = menu.srcStart;
            const end = menu.srcEnd ?? start;
            const line = menu.srcLine ?? content.slice(0, start).split("\n").length;
            applyLocateResult(
              {
                start,
                end,
                precision: "block",
                line,
                message: `已定位到所在段落（第 ${line} 行）`,
              },
              { select: true, focus: true, highlight: true }
            );
            setMenu(null);
            return;
          }
          setStatus("请先选中一段文字");
        },
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
      {
        id: "annotate",
        label: "划线批注",
        onSelect: () => {
          const root = articleRef.current;
          if (!root) return;
          const info = getPreviewSelectionInfo(root);
          if (!info || isTrivialSelection(info.text)) {
            setStatus("请先选中一段文字");
            return;
          }
          const result = locateInMarkdown({
            source: content,
            selectedText: info.text,
            startBlock: info.startBlock,
            endBlock: info.endBlock,
            anchorPlainOffset: info.anchorPlainOffset,
          });
          addAnnotation({
            docId: doc.id,
            quote: info.text,
            start: result.start,
            end: result.end,
            note: "",
          });
          setStatus("已添加划线批注");
          window.getSelection()?.removeAllRanges();
        },
      },
    ];
  }, [runLocate, content, setStatus, menu, addAnnotation, doc.id, applyLocateResult]);

  const mentionCount = React.useMemo(() => {
    if (doc.type !== "md") return 0;
    const titles = documents
      .filter((d) => d.id !== doc.id)
      .flatMap((d) => {
        const m = getDocMeta(d);
        return [titleOf(d.path), m.title, ...m.aliases];
      })
      .filter((x) => x && x.length >= 2);
    const self = getDocMeta(doc);
    return findUnlinkedMentions(content, titles, {
      excludeTitles: [titleOf(doc.path), self.title, ...self.aliases],
    }).length;
  }, [doc, documents, content]);

  const annotationCount = React.useMemo(
    () => annotations.filter((a) => a.docId === doc.id).length,
    [annotations, doc.id]
  );
  const assetCount = assetsForDoc(doc.id).length;



  // Soft-highlight annotation quotes in preview (does not mutate markdown body).
  React.useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    // clear previous
    root.querySelectorAll("mark.lh-annot-live").forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
    const anns = annotations.filter((a) => a.docId === doc.id && a.quote.trim());
    if (!anns.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tnode = n as Text;
      if (!tnode.nodeValue || !tnode.nodeValue.trim()) continue;
      if (tnode.parentElement?.closest("mark.lh-annot-live")) continue;
      textNodes.push(tnode);
    }
    for (const ann of anns) {
      const q = ann.quote.trim();
      for (const tn of textNodes) {
        const val = tn.nodeValue || "";
        const idx = val.indexOf(q);
        if (idx < 0) continue;
        try {
          const range = document.createRange();
          range.setStart(tn, idx);
          range.setEnd(tn, idx + q.length);
          const mark = document.createElement("mark");
          mark.className = `lh-annot lh-annot-live lh-annot-${ann.color}`;
          mark.title = ann.note || "划线";
          range.surroundContents(mark);
        } catch {
          /* cross-node — skip */
        }
        break;
      }
    }
  }, [annotations, doc.id, body]);

  const showRail =
    outlineRailOpen &&
    wide &&
    !mdFocusMode &&
    hasDocAsideContent(outline, backlinks, mentionCount, annotationCount, assetCount);

  return (
    <div className="h-full flex min-h-0">
      <div
        id={viewMode === "mixed" ? undefined : "reader-scroll"}
        className="flex-1 overflow-y-auto scroll-thin"
      >
        <div
          className={cn(
            "mx-auto flex w-full justify-center px-4 md:px-8 py-8",
            showRail && "gap-14"
          )}
          style={showRail ? { maxWidth: 740 + 56 + 240 } : undefined}
        >
        <article
          ref={articleRef}
          className="prose-langhuan relative w-full min-w-0 animate-enter"
          style={{
            maxWidth: readingPrefs.lineWidth,
            fontSize: readingPrefs.fontSize,
          }}
          onContextMenu={onContextMenu}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
          }}
          onDrop={async (e) => {
            const files = [...e.dataTransfer.files].filter((f) =>
              f.type.startsWith("image/")
            );
            if (!files.length) return;
            e.preventDefault();
            let next = getContent(doc.id);
            for (const f of files) {
              const res = await ingestImageFile(doc.id, f, f.name);
              if (res) {
                next = next.replace(/\s*$/, "") + `\n\n![${f.name}](${res.href})\n`;
              }
            }
            setDraft(doc.id, next);
            saveDoc(doc.id);
            setStatus(`已导入 ${files.length} 张图片`);
          }}
        >
          {!mdFocusMode && (
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
          )}

          <MarkdownBody
            body={body}
            fmOffset={fmOffset}
            fmLineOffset={fmLineOffset}
            documents={documents}
            openDoc={openDoc}
            assets={assets}
            docPath={doc.path}
          />
          {viewMode === "preview" &&
            inlineEdit?.kind !== "append" &&
            inlineEdit?.kind !== "insert" && (
            <PreviewGapHitLayer
              articleRef={articleRef}
              bodyKey={body}
              enabled
            />
          )}
          {viewMode === "preview" &&
            inlineEdit?.kind !== "append" &&
            inlineEdit?.kind !== "insert" && (
            <div
              data-lh-append-zone="1"
              className="group/append mt-1 min-h-[28vh] w-full cursor-text rounded-md"
              aria-label="点击继续写"
            >
              <div className="pointer-events-none select-none pt-3 text-sm text-[var(--muted)] opacity-0 transition-opacity group-hover/append:opacity-70">
                点击继续写
              </div>
            </div>
          )}
          {inlineEdit?.kind === "block" && inlineEdit.mode === "visual" && (
            <InlineVisualBlockEditor
              anchorEl={inlineEdit.el}
              originalSlice={inlineEdit.text}
              blockType={inlineEdit.blockType}
              clientX={inlineEdit.clientX}
              clientY={inlineEdit.clientY}
              caretAt={inlineEdit.caretAt}
              suppressBlurRef={suppressBlurCommitRef}
              onCommit={(nextSlice) => commitInlineEdit({ text: nextSlice })}
              onCancel={cancelInlineEdit}
              onSplit={handleVisualSplit}
              onMergePrev={handleVisualMergePrev}
              onNavigate={handleVisualNavigate}
            />
          )}
          {inlineEdit?.kind === "block" && inlineEdit.mode === "code" && (
            <InlineCodeFenceEditor
              anchorEl={inlineEdit.el}
              originalSlice={inlineEdit.text}
              cursorAt={inlineEdit.cursorAt}
              clientX={inlineEdit.clientX}
              clientY={inlineEdit.clientY}
              suppressBlurRef={suppressBlurCommitRef}
              onCommit={(nextSlice) => commitInlineEdit({ text: nextSlice })}
              onCancel={cancelInlineEdit}
            />
          )}
          {inlineEdit?.kind === "block" && inlineEdit.mode === "source" && (
            <InlineMdBlockEditor
              anchorEl={inlineEdit.el}
              value={inlineEdit.text}
              mono={inlineEdit.mono}
              cursorAt={inlineEdit.cursorAt}
              suppressBlurRef={suppressBlurCommitRef}
              onChange={(text) =>
                setInlineEdit((cur) => (cur ? { ...cur, text } : cur))
              }
              onCommit={() => commitInlineEdit()}
              onCancel={cancelInlineEdit}
            />
          )}
          {inlineEdit?.kind === "append" && (
            <div
              data-lh-inline-editor="1"
              className="lh-inline-edit-box mt-4 bg-transparent px-0 py-0"
            >
              <textarea
                autoFocus
                data-lh-inline-editor="textarea"
                value={inlineEdit.text}
                aria-label="继续写"
                placeholder="继续写…"
                className="w-full resize-none bg-transparent border-0 outline-none p-0 m-0 font-serif text-[length:inherit] leading-relaxed text-[var(--fg)] whitespace-pre-wrap placeholder:text-[var(--muted)] caret-[var(--accent)]"
                style={{ minHeight: 32, fontSize: "inherit", lineHeight: "inherit" }}
                onChange={(e) => {
                  const v = e.target.value;
                  setInlineEdit((cur) => (cur ? { ...cur, text: v } : cur));
                  e.target.style.height = "0px";
                  e.target.style.height = `${Math.max(e.target.scrollHeight, 32)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelInlineEdit();
                    return;
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    suppressBlurCommitRef.current = true;
                    commitInlineEdit();
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (suppressBlurCommitRef.current) {
                      suppressBlurCommitRef.current = false;
                      return;
                    }
                    commitInlineEdit();
                  }, 0);
                }}
              />
            </div>
          )}
          {inlineEdit?.kind === "insert" && (
            <InsertBetweenPortal
              anchorEl={inlineEdit.anchorEl}
              placeBefore={!!inlineEdit.placeBefore}
              text={inlineEdit.text}
              onChange={(text) =>
                setInlineEdit((cur) => (cur ? { ...cur, text } : cur))
              }
              onCommit={() => {
                suppressBlurCommitRef.current = true;
                commitInlineEdit();
              }}
              onCancel={cancelInlineEdit}
              suppressBlurRef={suppressBlurCommitRef}
              onBlurCommit={() => commitInlineEdit()}
            />
          )}
        </article>
        {showRail && (
          <DocAside
            outline={outline}
            backlinks={backlinks}
            activeHeading={activeHeading}
            variant="rail"
            doc={doc}
            onNavigateHeading={setActiveHeading}
          />
        )}
        </div>
      </div>

      {menu && (
        <PreviewContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

    </div>
  );
}
