"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import { splitMarkdownBlocks, joinMarkdownBlocks } from "@/lib/mdBlocks";
import { parseFrontmatter } from "@/lib/tags";
import { frontmatterOffset } from "@/lib/locate";
import { cn } from "@/lib/utils";
import {
  applyTypewriterBottomPad,
  centerTextareaCaret,
  scrollElementToTypewriterAnchor,
} from "@/lib/typewriterScroll";
import { collectTocEntries, isTocMarkerLine, type TocEntry } from "@/lib/tocMarker";
import { buildTocTree, type TocNode } from "@/lib/rehypeToc";
import { proseWidthForZoom } from "@/lib/readingPrefs";
import {
  effectiveZoom,
  scrollTopForViewportDelta,
} from "@/lib/outline";
import "katex/dist/katex.min.css";

/** Module-level — recreating plugin arrays each render forces react-markdown to reparse. */
const MIXED_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MIXED_REHYPE_PLUGINS = [rehypeKatex, rehypeSlug];

/** 混合模式的目录列表：与 rehypeToc 共用 buildTocTree，缩进层级保持一致。 */
function TocList({
  nodes,
  onJumpTo,
}: {
  nodes: TocNode[];
  onJumpTo: (entry: TocEntry) => void;
}) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.entry.id}>
          <a
            href={`#${node.entry.id}`}
            data-toc-target={node.entry.id}
            onClick={(e) => {
              // 混合模式没有整篇渲染出的标题节点，只能按标题文字去找对应的块。
              e.preventDefault();
              e.stopPropagation();
              onJumpTo(node.entry);
            }}
          >
            {node.entry.text}
          </a>
          {node.children.length > 0 && <TocList nodes={node.children} onJumpTo={onJumpTo} />}
        </li>
      ))}
    </ul>
  );
}

type MixedMdBlockProps = {
  text: string;
  isActive: boolean;
  fontSize: number;
  index: number;
  /** 打字机模式：当前块要在获得焦点/输入时跑回中线。 */
  typewriterMode: boolean;
  /** 这块是纯 TOC 标记时的目录树（由整篇正文算出）；null 表示普通块。 */
  tocEntries: TocNode[] | null;
  /** 点目录项：跳到对应标题所在的块。 */
  onJumpTo: (entry: TocEntry) => void;
  onActivate: (index: number) => void;
  onChange: (index: number, text: string) => void;
};

const MixedMdBlock = React.memo(function MixedMdBlock({
  text,
  isActive,
  fontSize,
  index,
  typewriterMode,
  tocEntries,
  onJumpTo,
  onActivate,
  onChange,
}: MixedMdBlockProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const rafRef = React.useRef(0);

  /**
   * 居中当前块。
   *
   * 优先滚 textarea 内部（这样长块里光标跟着走，而不是把整页推来推去）；
   * textarea 已经顶到自己的边界、或者块很短时，再退回去滚外层文档，
   * 让整块靠近中线。
   */
  const recenter = React.useCallback(() => {
    if (!typewriterMode) return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const ta = taRef.current;
      if (ta && ta.scrollHeight > ta.clientHeight + 1) {
        const scrolledInside = centerTextareaCaret(ta);
        // 内部还能滚，就先不动外层，避免「内外一起滚」的抽搐感。
        if (scrolledInside) return;
      }
      // 用 [data-md-scroll] 而不是 id：混合模式在专注/分屏下可能同屏两份。
      const scroller = wrapRef.current?.closest<HTMLElement>("[data-md-scroll]");
      scrollElementToTypewriterAnchor(scroller ?? null, wrapRef.current);
    });
  }, [typewriterMode]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  // 激活瞬间（点进来 / 键盘切块）就归位一次，不用等第一次按键。
  React.useEffect(() => {
    if (!isActive || !typewriterMode) return;
    recenter();
  }, [isActive, typewriterMode, recenter]);

  return (
    <div
      ref={wrapRef}
      data-md-block=""
      data-active={isActive ? "true" : "false"}
      className={cn(
        "rounded-xl transition-colors",
        isActive
          ? "ring-2 ring-[var(--accent)]/40 bg-[var(--bg-elevated)]"
          : "hover:bg-[var(--hover)] cursor-text"
      )}
      style={{ fontSize }}
      onClick={() => onActivate(index)}
    >
      {isActive ? (
        <textarea
          ref={taRef}
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(e) => onChange(index, e.target.value)}
          onKeyUp={recenter}
          onClick={recenter}
          onSelect={recenter}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
              return;
            }
            // 光标行变化后再量，否则读到的是按键前的滚动位置。
            recenter();
          }}
          className="w-full min-h-[3rem] resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-6 outline-none"
          rows={Math.max(2, text.split("\n").length + 1)}
          aria-label={`编辑块 ${index + 1}`}
        />
      ) : (
        <div className="prose-langhuan px-3 py-2 min-h-[2rem]">
          {tocEntries ? (
            // 混合模式是「一块一块」渲染的，rehypeToc 看不到别的块的标题，
            // 所以这一块直接按整篇正文算好的目录项画出来，不再走 Markdown 管线。
            // 只读渲染 / 整块源码编辑：点一下进入 textarea，里面仍是 `<!-- toc -->` 原文。
            <div className="lh-toc" data-toc role="navigation" aria-label="目录">
              <p className="lh-toc-title">目录</p>
              {tocEntries.length ? (
                <TocList nodes={tocEntries} onJumpTo={onJumpTo} />
              ) : (
                <p className="lh-toc-empty">（目录为空：加上标题后这里会自动列出）</p>
              )}
            </div>
          ) : text.trim() ? (
            <ReactMarkdown
              remarkPlugins={MIXED_REMARK_PLUGINS}
              rehypePlugins={MIXED_REHYPE_PLUGINS}
            >
              {text}
            </ReactMarkdown>
          ) : (
            <span className="text-[var(--muted)] text-sm font-ui">
              空块 · 点击编辑
            </span>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) =>
  prev.text === next.text &&
  prev.isActive === next.isActive &&
  prev.fontSize === next.fontSize &&
  prev.index === next.index &&
  prev.typewriterMode === next.typewriterMode &&
  prev.tocEntries === next.tocEntries &&
  prev.onJumpTo === next.onJumpTo &&
  prev.onActivate === next.onActivate &&
  prev.onChange === next.onChange
);

/**
 * Typora-like MVP: inactive blocks render as Markdown; active block is a textarea.
 */
export function MixedMdView({ doc }: { doc: Document }) {
  const getContent = useStore((s) => s.getContent);
  const setDraft = useStore((s) => s.setDraft);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const viewMode = useStore((s) => s.viewMode);
  const typewriterMode = readingPrefs.typewriterMode;
  const content = getContent(doc.id);
  const { body } = parseFrontmatter(content);
  const fmOff = frontmatterOffset(content);
  const fmPrefix = content.slice(0, fmOff);

  const blocks = React.useMemo(() => splitMarkdownBlocks(body), [body]);
  const [active, setActive] = React.useState<number>(0);
  const [drafts, setDrafts] = React.useState<string[]>(() =>
    blocks.map((b) => b.text)
  );
  const draftsRef = React.useRef(drafts);
  draftsRef.current = drafts;
  const docIdRef = React.useRef(doc.id);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Align drafts only when the doc switches or body text truly diverges from
  // what our drafts would produce — not on documents[] / updatedAt identity churn.
  React.useEffect(() => {
    if (docIdRef.current !== doc.id) {
      docIdRef.current = doc.id;
      setDrafts(blocks.map((b) => b.text));
      setActive(0);
      return;
    }
    const fromDrafts = joinMarkdownBlocks(draftsRef.current);
    if (fromDrafts === body) return;
    setDrafts(blocks.map((b) => b.text));
    setActive((i) => Math.min(i, Math.max(0, blocks.length - 1)));
  }, [doc.id, body, blocks]);

  /**
   * 文末留白：没有这块空白，最后一块无论怎么写都到不了中线。
   * 只在打字机模式打开时挂内联样式，关掉后交还 CSS。
   */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      // 与源码编辑器同一套计算，避免两种模式留白不一致。
      applyTypewriterBottomPad(el, typewriterMode);
      // 外层留白会改变可滚高度，顺带把当前块重新归位一次。
      if (typewriterMode) {
        const activeEl = el.querySelector<HTMLElement>('[data-md-block][data-active="true"]');
        scrollElementToTypewriterAnchor(el, activeEl);
      }
    };
    apply();
    if (!typewriterMode) return;
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [typewriterMode]);

  const commit = React.useCallback(
    (nextDrafts: string[]) => {
      const joined = joinMarkdownBlocks(nextDrafts);
      const next = fmPrefix ? `${fmPrefix}${joined}` : joined;
      setDraft(doc.id, next);
    },
    [doc.id, fmPrefix, setDraft]
  );

  const onActivate = React.useCallback((index: number) => {
    setActive(index);
  }, []);

  /**
   * 文内目录项（整篇正文算一遍）。
   * 混合模式每块独立渲染，`rehypeToc` 看不到别的块，所以这一块只能在这里算好喂进去。
   */
  const tocEntries = React.useMemo(() => buildTocTree(collectTocEntries(body)), [body]);

  /**
   * 点目录项 → 滚到对应标题块。
   *
   * 混合模式没有 `<h2 id>` 这样的锚点节点，只能自己找块。注意**不能用 DOM 里的文字**：
   * 失活块是渲染后的 Markdown，`##` 早就不在 DOM 里了，只读的 `textContent` 是
   * 「第二节 收束」而不是「## 第二节 收束」。所以匹配用的是草稿原文（`draftsRef`），
   * 下标再映射回第 N 个 `[data-md-block]`。
   *
   * 找不到就什么都不做——比乱跳到一个不相干的块好。
   */
  const onJumpTo = React.useCallback(
    (entry: TocEntry) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const want = entry.text.trim();
      const texts = draftsRef.current;
      const index = texts.findIndex((block) =>
        block.split(/\r?\n/).some((line) => {
          const m = line.match(/^ {0,3}#{1,4}[ \t]+(.+)$/);
          return !!m && m[1]!.replace(/[#*`]/g, "").trim() === want;
        })
      );
      if (index < 0) return;
      const el = scroller.querySelectorAll<HTMLElement>("[data-md-block]")[index];
      if (!el) return;
      // 跳到块的顶部附近，而不是居中——读者要看的是这一节的开头。
      // zoom 生效时 rect 差值是屏幕像素，乘回 zoom 才是容器的 scrollTop 单位。
      const viewportDelta =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({
        top: scrollTopForViewportDelta(scroller.scrollTop, viewportDelta, effectiveZoom(el), 24),
        behavior: "smooth",
      });
    },
    []
  );

  const onChangeBlock = React.useCallback(
    (index: number, text: string) => {
      setDrafts((prev) => {
        const next = [...prev];
        next[index] = text;
        commit(next);
        return next;
      });
    },
    [commit]
  );

  return (
    <div
      ref={scrollRef}
      data-md-scroll=""
      id={viewMode === "mixed" ? "reader-scroll" : undefined}
      className="h-full overflow-y-auto scroll-thin px-4 md:px-8 py-8"
    >
      <div
        className="mx-auto space-y-3"
        style={{
          // 与预览同一套换算：zoom 会把 maxWidth 一起放大，所以先除回去，
          // 视觉版心宽度仍等于 lineWidth。混合模式也是 MD 预览，缩放要跟着走。
          maxWidth: proseWidthForZoom(readingPrefs.zoom, readingPrefs.lineWidth),
          fontSize: readingPrefs.fontSize,
          zoom: readingPrefs.zoom,
        }}
      >
        {drafts.map((text, i) => {
          const meta = blocks[i];
          // Prefer source-range key; fall back to index when drafts outpace split
          // (e.g. just-added empty block before body echo lands).
          // Prefer source start (stable while editing this block's text).
          // Including end would remount the active textarea on every length change.
          const key = meta != null ? `b-${meta.start}` : `draft-${i}`;
          // 纯标记块（整块只有一行 `<!-- toc -->`）走只读目录渲染。
          const isTocBlock = text.split(/\r?\n/).filter((l) => l.trim()).every(isTocMarkerLine)
            && text.split(/\r?\n/).some(isTocMarkerLine);
          return (
            <MixedMdBlock
              key={key}
              text={text}
              isActive={i === active}
              fontSize={readingPrefs.fontSize}
              index={i}
              typewriterMode={typewriterMode}
              tocEntries={isTocBlock ? tocEntries : null}
              onJumpTo={onJumpTo}
              onActivate={onActivate}
              onChange={onChangeBlock}
            />
          );
        })}
        <button
          type="button"
          className="w-full rounded-xl border border-dashed border-[var(--border)] py-2 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] font-ui"
          onClick={() => {
            const next = [...drafts, ""];
            setDrafts(next);
            setActive(next.length - 1);
            commit(next);
          }}
        >
          + 添加块
        </button>
      </div>
    </div>
  );
}
