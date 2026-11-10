/**
 * Store-agnostic glue for「收入藏书阁 / 收入速记」.
 *
 * Kept free of `useStore` (and therefore of the persist/idb side effects) so it
 * can be unit-tested with a tiny fake writer. `captureToLibrary.ts` binds this
 * to the real notes store.
 *
 * 速记 is a read-modify-write on one note: read the live body, append a block,
 * persist. Two rapid captures would both read the same body and the second
 * write would drop the first block. Every capture therefore runs through a
 * per-note serial queue and only reports success after `write` has confirmed
 * the body reached disk.
 */

import {
  appendExplainSection,
  appendSnippetBlock,
  buildExplainNote,
  buildExplainSection,
  buildExplainThreadNote,
  buildSnippetBlock,
  explainNotePath,
  explainThreadNotePath,
  noteDateStamp,
  snippetNotePath,
  SNIPPET_NOTE_HEADER,
  type ExplainCitation,
  type ExplainThreadTurn,
} from "./captureNote";

export type CaptureResult =
  | {
      ok: true;
      docId: string;
      path: string;
      /** The store had to rename (only possible on a fresh note). */
      renamed: boolean;
      /** True when this capture landed inside an existing same-day note. */
      appended: boolean;
    }
  | { ok: false; message: string };

/** Outcome of the durable write; success is only claimed when this is ok. */
export type CaptureWriteOutcome = { ok: true } | { ok: false; message: string };

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
  /**
   * Persist a body (createDoc alone is memory-only). Must resolve only once the
   * note is on disk — a rejected/negative outcome is reported to the caller.
   */
  write: (docId: string, content: string) => Promise<CaptureWriteOutcome>;
};

export type ExplainCaptureInput = {
  question: string;
  answer: string;
  projectName?: string | null;
  sourcePath?: string | null;
  /** Jump line for the file link; defaults to the earliest cite in that file. */
  sourceLine?: number;
  citations?: ExplainCitation[];
  createdAt?: number;
  projectId?: string | null;
  sourceSnapshot?: string | null;
  sourceEndLine?: number;
};

/** One tail promise per note path — the serial queue for read-modify-write. */
const captureQueues = new Map<string, Promise<unknown>>();

/**
 * Run `task` after every capture already queued for `key`, regardless of
 * whether those succeeded. Keeps appends in click order and prevents the
 * second capture from reading a body the first has not written yet.
 */
function enqueueCapture<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = captureQueues.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // The stored tail must never reject, or later captures would be skipped.
  const tail = run.catch(() => undefined);
  captureQueues.set(key, tail);
  void tail.then(() => {
    // Drop the entry once this was the last queued capture for the path.
    if (captureQueues.get(key) === tail) captureQueues.delete(key);
  });
  return run;
}

/** Test helper: forget queued tails between cases. */
export function resetCaptureQueues(): void {
  captureQueues.clear();
}

/**
 * B1 — one explain turn lands in 读码笔记/<工程>/YYYY-MM-DD-<文件>.md.
 *
 * One day + one file = one note. The first capture of the day creates it with
 * frontmatter; every later capture of the same file appends a `## HH:mm · …`
 * section, so re-reading a file over a day builds one note instead of a pile of
 * `-2.md` look-alikes. Returns the real saved path so the UI can offer
 *「在藏书阁打开」and never lie about an unpersisted note.
 */
export async function captureExplain(
  writer: NoteWriter,
  input: ExplainCaptureInput
): Promise<CaptureResult> {
  if (!input.answer.trim()) {
    return { ok: false, message: "讲解还没有内容，先等它生成完" };
  }
  const requested = explainNotePath({
    projectName: input.projectName,
    sourcePath: input.sourcePath || "未命名文件",
    // The note's date comes from the turn's own time, not the wall clock at
    // click time: replaying yesterday's captured answer must not file it today.
    date: noteDateStamp(new Date(input.createdAt ?? Date.now())),
  });
  // One queue per note path: two rapid captures of the same file must serialize
  // their read-modify-write, exactly like 速记.
  return enqueueCapture(requested, async () => {
    try {
      const existing = writer.findByPath(requested);
      if (existing) {
        const next = appendExplainSection(
          writer.contentOf(existing.id),
          buildExplainSection(input)
        );
        const written = await writer.write(existing.id, next);
        if (!written.ok) {
          return { ok: false, message: `收入失败：${written.message}` };
        }
        return {
          ok: true,
          docId: existing.id,
          path: existing.path,
          renamed: false,
          appended: true,
        };
      }
      const doc = writer.create({
        type: "md",
        path: requested,
        content: buildExplainNote(input),
      });
      if (!doc) return { ok: false, message: "新建笔记失败" };
      const written = await writer.write(doc.id, doc.content);
      if (!written.ok) {
        return { ok: false, message: `收入失败：${written.message}` };
      }
      return {
        ok: true,
        docId: doc.id,
        path: doc.path,
        renamed: requested !== doc.path,
        appended: false,
      };
    } catch (e) {
      return {
        ok: false,
        message: `收入失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

export type SnippetCaptureInput = {
  path: string;
  fromLine: number;
  toLine: number;
  text: string;
  lang?: string;
  /** Extra context under the block, e.g. 「来自讲解选区」. */
  note?: string;
  projectId?: string | null;
  projectName?: string | null;
  capturedAt?: number;
};

/**
 * B2 — append a selection to 读码笔记/速记.md (creating it on first use).
 *
 * Serialized per note: the body is re-read inside the queue, so a burst of
 * captures appends in click order instead of overwriting each other.
 */
export async function captureSnippet(
  writer: NoteWriter,
  input: SnippetCaptureInput
): Promise<CaptureResult> {
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
    projectId: input.projectId,
    projectName: input.projectName,
    capturedAt: input.capturedAt,
  });

  return enqueueCapture(requested, async () => {
    try {
      const existing = writer.findByPath(requested);
      if (!existing) {
        const doc = writer.create({
          type: "md",
          path: requested,
          content: appendSnippetBlock(SNIPPET_NOTE_HEADER, block),
        });
        if (!doc) return { ok: false, message: "新建速记失败" };
        const written = await writer.write(doc.id, doc.content);
        if (!written.ok) {
          return { ok: false, message: `收入速记失败：${written.message}` };
        }
        return {
          ok: true,
          docId: doc.id,
          path: doc.path,
          renamed: false,
          appended: false,
        };
      }

      const next = appendSnippetBlock(writer.contentOf(existing.id), block);
      const written = await writer.write(existing.id, next);
      if (!written.ok) {
        return { ok: false, message: `收入速记失败：${written.message}` };
      }
      return {
        ok: true,
        docId: existing.id,
        path: existing.path,
        renamed: false,
        appended: true,
      };
    } catch (e) {
      return {
        ok: false,
        message: `收入速记失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

export type ExplainThreadCaptureInput = {
  /** 当前 thread 的短标题（Header 显示的那个）。 */
  title: string;
  turns: ExplainThreadTurn[];
  projectName?: string | null;
  projectId?: string | null;
  /** 收入时刻；同时决定文件名里的日期。 */
  createdAt?: number;
};

/**
 * 「收入本段对话」：当前 thread 全文 → 读码笔记/<工程>/YYYY-MM-DD-讲解-<短标题>.md。
 *
 * 与单条收入同一天同一文件的「追加一节」不同，这里**整篇覆盖**：同一 thread
 * 再收入一次只会刷新那篇，不会把同样的问答再抄一遍。仍走同一把按路径的串行
 * 队列，所以连点不会交错读写。
 */
export async function captureExplainThread(
  writer: NoteWriter,
  input: ExplainThreadCaptureInput
): Promise<CaptureResult> {
  const turns = input.turns.filter((t) => t.content.trim());
  if (turns.length === 0) {
    return { ok: false, message: "这段对话还没有内容，先问一句" };
  }

  const requested = explainThreadNotePath({
    projectName: input.projectName,
    title: input.title,
    date: noteDateStamp(new Date(input.createdAt ?? Date.now())),
  });
  const body = buildExplainThreadNote({
    projectName: input.projectName,
    projectId: input.projectId,
    title: input.title,
    turns,
    createdAt: input.createdAt,
  });

  return enqueueCapture(requested, async () => {
    try {
      const existing = writer.findByPath(requested);
      if (existing) {
        const written = await writer.write(existing.id, body);
        if (!written.ok) {
          return { ok: false, message: `收入失败：${written.message}` };
        }
        return {
          ok: true,
          docId: existing.id,
          path: existing.path,
          renamed: false,
          appended: false,
        };
      }
      const doc = writer.create({ type: "md", path: requested, content: body });
      if (!doc) return { ok: false, message: "新建笔记失败" };
      const written = await writer.write(doc.id, doc.content);
      if (!written.ok) {
        return { ok: false, message: `收入失败：${written.message}` };
      }
      return {
        ok: true,
        docId: doc.id,
        path: doc.path,
        renamed: requested !== doc.path,
        appended: false,
      };
    } catch (e) {
      return {
        ok: false,
        message: `收入失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}


/**
 * Append a citation / snippet block to an existing library note (not necessarily 速记.md).
 * Used by 「引用到笔记」when a note is already open.
 */
export async function captureSnippetIntoDoc(
  writer: NoteWriter,
  target: { id: string; path: string },
  input: SnippetCaptureInput
): Promise<CaptureResult> {
  const body = String(input.text ?? "");
  if (!body.trim()) return { ok: false, message: "选区是空的" };
  const block = buildSnippetBlock({
    path: input.path,
    fromLine: input.fromLine,
    toLine: input.toLine,
    text: body,
    lang: input.lang,
    note: input.note,
    projectId: input.projectId,
    projectName: input.projectName,
    capturedAt: input.capturedAt,
  });
  return enqueueCapture(target.path, async () => {
    try {
      const next = appendExplainSection(writer.contentOf(target.id), block);
      const written = await writer.write(target.id, next);
      if (!written.ok) {
        return { ok: false, message: `引用失败：${written.message}` };
      }
      return {
        ok: true,
        docId: target.id,
        path: target.path,
        renamed: false,
        appended: true,
      };
    } catch (e) {
      return {
        ok: false,
        message: `引用失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

/** Status line after a successful capture, naming the real path. */
export function captureStatusMessage(
  result: Extract<CaptureResult, { ok: true }>,
  verb = "已收入藏书阁"
): string {
  if (result.renamed) return `${verb} · 重名已加后缀 → ${result.path}`;
  // An append is a different promise than a new note: say which happened.
  return result.appended
    ? `${verb} · 已追加到 ${result.path}`
    : `${verb} · ${result.path}`;
}
