/**
 * Store-agnostic glue for「收入藏书阁 / 收入速记」.
 *
 * Kept free of `useStore` (and therefore of the persist/idb side effects) so it
 * can be unit-tested with a tiny fake writer. `captureToLibrary.ts` binds this
 * to the real notes store.
 */

import {
  appendSnippetBlock,
  buildExplainNote,
  buildSnippetBlock,
  explainNotePath,
  snippetNotePath,
  SNIPPET_NOTE_HEADER,
  type ExplainCitation,
} from "./captureNote";

export type CaptureResult =
  | { ok: true; docId: string; path: string; renamed: boolean }
  | { ok: false; message: string };

/** The four store operations these captures need — nothing else. */
export type NoteWriter = {
  /** Existing document path (exact, normalized) or undefined. */
  findByPath: (path: string) => { id: string; path: string } | undefined;
  /** Current content of a doc (draft wins over saved body). */
  contentOf: (docId: string) => string;
  /** Create a note; the store applies its own rename rule for duplicates. */
  create: (input: {
    type: "md";
    path: string;
    content: string;
  }) => { id: string; path: string; content: string } | null;
  /** Persist a body immediately (createDoc alone is memory-only). */
  write: (docId: string, content: string) => void;
};

export type ExplainCaptureInput = {
  question: string;
  answer: string;
  projectName?: string | null;
  sourcePath?: string | null;
  citations?: ExplainCitation[];
  createdAt?: number;
};

/**
 * B1 — one explain turn becomes one note under 读码笔记/<工程>/YYYY-MM-DD-<文件>.md.
 * Returns the real saved path so the UI can offer「在藏书阁打开」and never lie
 * about a rename.
 */
export function captureExplain(
  writer: NoteWriter,
  input: ExplainCaptureInput
): CaptureResult {
  if (!input.answer.trim()) {
    return { ok: false, message: "讲解还没有内容，先等它生成完" };
  }
  const requested = explainNotePath({
    projectName: input.projectName,
    sourcePath: input.sourcePath || "未命名文件",
  });
  try {
    const doc = writer.create({
      type: "md",
      path: requested,
      content: buildExplainNote(input),
    });
    if (!doc) return { ok: false, message: "新建笔记失败" };
    writer.write(doc.id, doc.content);
    return {
      ok: true,
      docId: doc.id,
      path: doc.path,
      renamed: requested !== doc.path,
    };
  } catch (e) {
    return {
      ok: false,
      message: `收入失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export type SnippetCaptureInput = {
  path: string;
  fromLine: number;
  toLine: number;
  text: string;
  lang?: string;
  /** Extra context under the block, e.g. 「来自讲解选区」. */
  note?: string;
};

/**
 * B2 — append a selection to 读码笔记/速记.md (creating it on first use).
 * Appending re-reads the live draft so concurrent edits are not clobbered.
 */
export function captureSnippet(
  writer: NoteWriter,
  input: SnippetCaptureInput
): CaptureResult {
  const body = String(input.text ?? "");
  if (!body.trim()) return { ok: false, message: "选区是空的" };

  const requested = snippetNotePath();
  const block = buildSnippetBlock({
    path: input.path,
    fromLine: input.fromLine,
    toLine: input.toLine,
    text: body,
    lang: input.lang,
    note: input.note,
  });

  const existing = writer.findByPath(requested);
  try {
    if (!existing) {
      const doc = writer.create({
        type: "md",
        path: requested,
        content: appendSnippetBlock(SNIPPET_NOTE_HEADER, block),
      });
      if (!doc) return { ok: false, message: "新建速记失败" };
      writer.write(doc.id, doc.content);
      return { ok: true, docId: doc.id, path: doc.path, renamed: false };
    }

    const next = appendSnippetBlock(writer.contentOf(existing.id), block);
    writer.write(existing.id, next);
    return { ok: true, docId: existing.id, path: existing.path, renamed: false };
  } catch (e) {
    return {
      ok: false,
      message: `收入速记失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Status line after a successful capture, naming the real path. */
export function captureStatusMessage(
  result: Extract<CaptureResult, { ok: true }>,
  verb = "已收入藏书阁"
): string {
  return result.renamed
    ? `${verb} · 重名已加后缀 → ${result.path}`
    : `${verb} · ${result.path}`;
}
