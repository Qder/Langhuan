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
import "katex/dist/katex.min.css";

/** Module-level — recreating plugin arrays each render forces react-markdown to reparse. */
const MIXED_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MIXED_REHYPE_PLUGINS = [rehypeKatex, rehypeSlug];

type MixedMdBlockProps = {
  text: string;
  isActive: boolean;
  fontSize: number;
  index: number;
  onActivate: (index: number) => void;
  onChange: (index: number, text: string) => void;
};

const MixedMdBlock = React.memo(function MixedMdBlock({
  text,
  isActive,
  fontSize,
  index,
  onActivate,
  onChange,
}: MixedMdBlockProps) {
  return (
    <div
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
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(e) => onChange(index, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full min-h-[3rem] resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-6 outline-none"
          rows={Math.max(2, text.split("\n").length + 1)}
          aria-label={`编辑块 ${index + 1}`}
        />
      ) : (
        <div className="prose-langhuan px-3 py-2 min-h-[2rem]">
          {text.trim() ? (
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
      id={viewMode === "mixed" ? "reader-scroll" : undefined}
      className="h-full overflow-y-auto scroll-thin px-4 md:px-8 py-8"
    >
      <div
        className="mx-auto space-y-3"
        style={{
          maxWidth: readingPrefs.lineWidth,
          fontSize: readingPrefs.fontSize,
        }}
      >
        {drafts.map((text, i) => {
          const meta = blocks[i];
          // Prefer source-range key; fall back to index when drafts outpace split
          // (e.g. just-added empty block before body echo lands).
          // Prefer source start (stable while editing this block's text).
          // Including end would remount the active textarea on every length change.
          const key = meta != null ? `b-${meta.start}` : `draft-${i}`;
          return (
            <MixedMdBlock
              key={key}
              text={text}
              isActive={i === active}
              fontSize={readingPrefs.fontSize}
              index={i}
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
