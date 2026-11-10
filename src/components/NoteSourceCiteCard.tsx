"use client";

import * as React from "react";
import { parseNoteSourceCitationBody, type NoteSourceCitation } from "@/lib/ide/noteSourceCitation";
import { followNoteSourceCitation } from "@/lib/ide/followNoteSourceCitation";
import { ideLinkLabel } from "@/lib/ide/ideLink";

export function NoteSourceCiteCard({
  text,
  srcStart,
  srcEnd,
}: {
  text: string;
  srcStart?: number;
  srcEnd?: number;
}) {
  const citation = React.useMemo(
    () => parseNoteSourceCitationBody(text),
    [text]
  );
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!citation) {
    return (
      <pre className="lh-codeblock my-5 overflow-x-auto">
        <code>{text}</code>
      </pre>
    );
  }

  const label = ideLinkLabel({
    path: citation.path,
    line: citation.fromLine,
    endLine: citation.toLine,
  }, 80);

  const onJump = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await followNoteSourceCitation(citation);
      if (result.showedSnapshot && !result.jumped) {
        setStatus("原文已找不到或已改写，下面是链接时保存的快照。");
      }
    } finally {
      setBusy(false);
    }
  };

  const attrs =
    typeof srcStart === "number" && typeof srcEnd === "number"
      ? { "data-src-start": srcStart, "data-src-end": srcEnd }
      : {};

  return (
    <section
      className="not-prose my-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden"
      data-lh-cite="1"
      {...attrs}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--chrome)]">
        <div className="min-w-0 flex-1 font-mono text-sm text-[var(--fg)] truncate" title={label}>
          {label}
        </div>
        {citation.projectName && (
          <span className="text-[11px] text-[var(--muted)] font-ui shrink-0">
            {citation.projectName}
          </span>
        )}
        <button
          type="button"
          className="shrink-0 min-h-11 px-3 rounded-xl text-sm font-ui bg-[var(--accent)] text-white disabled:opacity-60"
          aria-label="跳回源码"
          disabled={busy}
          onClick={() => void onJump()}
        >
          {busy ? "正在跳转…" : "跳回源码"}
        </button>
      </div>
      {citation.note && (
        <p className="px-3 py-2 text-sm font-ui text-[var(--fg)] border-b border-[var(--border)]">
          {citation.note}
        </p>
      )}
      {status && (
        <p className="px-3 py-2 text-xs font-ui text-[var(--gold)] border-b border-[var(--border)]" role="status">
          {status}
        </p>
      )}
      <pre className="!m-0 !border-0 !rounded-none overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code>{citation.snapshot}</code>
      </pre>
    </section>
  );
}

export function isNoteSourceCiteClass(className?: string): boolean {
  return typeof className === "string" && /(^|\s)language-lh-cite(\s|$)/.test(className);
}

export function citationFromCodeText(text: string): NoteSourceCitation | null {
  return parseNoteSourceCitationBody(text);
}
