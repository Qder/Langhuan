"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  listFooterCitations,
  parseIdeCitations,
  type IdeCitation,
} from "@/lib/ide/citations";
import { flattenCodeText } from "@/lib/codeText";
import {
  fenceChipLabel,
  parseExplainFences,
  type ExplainFence,
} from "@/lib/ide/snippetLocate";
import { cn } from "@/lib/utils";

function chipLabel(c: Pick<IdeCitation, "path" | "line" | "endLine">): string {
  const base = c.path.split("/").pop() || c.path;
  if (c.line == null) return base;
  if (c.endLine != null && c.endLine !== c.line) return `${base}:${c.line}-${c.endLine}`;
  return `${base}:${c.line}`;
}

/** Split markdown into text / citation segments for chip rendering. */
function segmentExplain(md: string): Array<
  | { type: "text"; value: string }
  | { type: "cite"; citation: IdeCitation }
> {
  const cites = parseIdeCitations(md).filter((c) => {
    const raw = c.raw;
    // Fence-info paths stay in the markdown so the code block still parses;
    // they remain clickable in the footer / on the fence chrome.
    return (
      raw.startsWith("[[") ||
      raw.startsWith("`") ||
      raw.includes("ide://") ||
      /^\[[^\]]*\]\(/.test(raw)
    );
  });
  if (cites.length === 0) return [{ type: "text", value: md }];
  const out: Array<
    { type: "text"; value: string } | { type: "cite"; citation: IdeCitation }
  > = [];
  let cursor = 0;
  for (const c of cites) {
    if (c.index > cursor) {
      out.push({ type: "text", value: md.slice(cursor, c.index) });
    }
    out.push({ type: "cite", citation: c });
    cursor = c.endIndex;
  }
  if (cursor < md.length) out.push({ type: "text", value: md.slice(cursor) });
  return out;
}

function fenceHint(f: ExplainFence): string {
  if (f.path && f.line != null) {
    if (f.endLine != null && f.endLine !== f.line) {
      return `${f.path}:${f.line}-${f.endLine}`;
    }
    return `${f.path}:${f.line}`;
  }
  if (f.path) return f.path;
  return "点击定位源码";
}

const ExplainFenceCard = React.memo(function ExplainFenceCard({
  text,
  fence,
  onFence,
}: {
  text: string;
  fence?: ExplainFence;
  onFence?: (f: ExplainFence) => void;
}) {
  const synthetic: ExplainFence = fence ?? {
    lang: "",
    info: "",
    body: text,
    index: 0,
    endIndex: 0,
  };
  const clickable = typeof onFence === "function";
  const hint = fenceHint(synthetic);
  return (
    <div className="my-2 rounded-lg border border-[var(--border)] overflow-hidden text-left">
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-mono text-[var(--muted)] bg-[var(--hover)]">
        <span>{synthetic.lang || "code"}</span>
        {clickable && (
          <button
            type="button"
            title={hint}
            onClick={() => onFence!(synthetic)}
            className="shrink-0 text-[var(--accent)] truncate max-w-[70%] hover:underline"
          >
            {hint}
          </button>
        )}
      </div>
      <pre className="m-0 px-2 py-2 overflow-x-auto text-[12px] leading-5 font-mono select-text">
        <code>{text}</code>
      </pre>
    </div>
  );
});

export const ExplainBody = React.memo(function ExplainBody({
  content,
  onCite,
  onFence,
}: {
  content: string;
  onCite: (c: IdeCitation) => void;
  onFence?: (f: ExplainFence) => void;
}) {
  const parts = segmentExplain(content);
  const fences = React.useMemo(() => parseExplainFences(content), [content]);
  const used = new Set<number>();

  const takeFence = (text: string): ExplainFence | undefined => {
    const want = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const idx = fences.findIndex((f, i) => !used.has(i) && f.body === want);
    if (idx < 0) return undefined;
    used.add(idx);
    return fences[idx];
  };

  return (
    <div className="space-y-1 text-sm leading-relaxed font-ui text-[var(--fg)]">
      {parts.map((p, i) => {
        if (p.type === "text") {
          if (!p.value.trim()) return null;
          return (
            <ReactMarkdown
              key={`t-${p.value.length}:${i}`}
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }: { children?: React.ReactNode }) => (
                  <p className="my-1.5">{children}</p>
                ),
                pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
                code: ({
                  className,
                  children,
                  ...props
                }: {
                  className?: string;
                  children?: React.ReactNode;
                  inline?: boolean;
                } & Record<string, unknown>) => {
                  const inline = props.inline;
                  const text = flattenCodeText(children).replace(/\n$/, "");
                  const isBlock =
                    inline === false ||
                    (typeof className === "string" &&
                      /(^|\s)language-/.test(className)) ||
                    text.includes("\n");
                  if (!isBlock) {
                    return (
                      <code className="rounded px-1 py-0.5 bg-[var(--hover)] text-[12px] font-mono">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <ExplainFenceCard
                      text={text}
                      fence={takeFence(text)}
                      onFence={onFence}
                    />
                  );
                },
                a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
                  <a
                    href={href}
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                ),
              } as never}
            >
              {p.value}
            </ReactMarkdown>
          );
        }
        const c = p.citation;
        return (
          <button
            key={`c-${c.index}:${c.path}:${c.line ?? ""}`}
            type="button"
            title={c.path + (c.line != null ? `:${c.line}` : "")}
            onClick={() => onCite(c)}
            className={cn(
              "inline-flex items-center align-middle mx-0.5 my-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {chipLabel(c)}
          </button>
        );
      })}
    </div>
  );
});

export const ExplainFooterCitations = React.memo(function ExplainFooterCitations({
  content,
  onCite,
  onFence,
}: {
  content: string;
  onCite: (c: IdeCitation) => void;
  onFence?: (f: ExplainFence) => void;
}) {
  const list = listFooterCitations(content);
  const extraFences = parseExplainFences(content).filter((f) => !f.path);
  if (list.length === 0 && extraFences.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border)]">
      <div className="text-[10px] text-[var(--muted)] mb-1 font-ui">本次引用</div>
      <div className="flex flex-wrap gap-1">
        {list.map((c) => (
          <button
            key={`foot-${c.index}:${c.path}:${c.line ?? ""}:${c.endLine ?? ""}`}
            type="button"
            title={c.path + (c.line != null ? `:${c.line}` : "")}
            onClick={() => onCite(c)}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {c.path}
            {c.line != null
              ? c.endLine != null && c.endLine !== c.line
                ? `:${c.line}-${c.endLine}`
                : `:${c.line}`
              : ""}
          </button>
        ))}
        {extraFences.map((f, i) => (
          <button
            key={`fence-${f.index}:${f.path ?? ""}:${i}`}
            type="button"
            title="按代码块正文定位"
            onClick={() => onFence?.(f)}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {fenceChipLabel(f)}
          </button>
        ))}
      </div>
    </div>
  );
});
