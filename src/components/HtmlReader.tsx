"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { getTags } from "@/lib/tags";
import { relativeTime } from "@/lib/utils";
import type { Document } from "@/lib/types";

export function HtmlReader({ doc }: { doc: Document }) {
  const getContent = useStore((s) => s.getContent);
  const setDocTags = useStore((s) => s.setDocTags);
  const content = getContent(doc.id);
  const tags = getTags({ ...doc, content });
  const [tagInput, setTagInput] = React.useState("");

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-2 text-xs text-[var(--muted)] font-ui">
        <span className="rounded-full border border-[var(--teal)]/40 text-[var(--teal)] px-2 py-0.5">HTML</span>
        <span>更新于 {relativeTime(doc.updatedAt)}</span>
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5">
            {t}
            <button
              type="button"
              aria-label={`删除标签 ${t}`}
              onClick={() => setDocTags(doc.id, tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
        <form
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
      <div className="flex-1 min-h-0 p-3 md:p-4">
        <iframe
          title={doc.path}
          srcDoc={content}
          sandbox="allow-scripts allow-popups allow-forms"
          className="h-full w-full rounded-2xl border border-[var(--border)] bg-white"
        />
      </div>
    </div>
  );
}
