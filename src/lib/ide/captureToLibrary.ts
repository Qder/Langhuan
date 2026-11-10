/**
 * 读码 → 藏书阁 的写入动作（B1 / B2）。
 *
 * The markdown shape and the "create vs append" decision live in pure modules
 * (`captureNote.ts` / `capturePlan.ts`); this file only binds them to the real
 * notes store — `createDoc` for a new note, `setDraft` + durable save to append.
 * No second storage layer, no direct content/ writes.
 *
 * The writer's `write` resolves only after the note reached disk, so a capture
 * never reports success on an in-memory change alone.
 */

"use client";

import { useStore } from "@/lib/store";
import {
  captureExplain,
  captureExplainThread,
  captureSnippet,
  captureSnippetIntoDoc,
  captureStatusMessage,
  type CaptureWriteOutcome,
  type ExplainCaptureInput,
  type ExplainThreadCaptureInput,
  type NoteWriter,
  type SnippetCaptureInput,
} from "./capturePlan";

export type {
  CaptureResult,
  ExplainCaptureInput,
  ExplainThreadCaptureInput,
  SnippetCaptureInput,
} from "./capturePlan";
export { captureStatusMessage };

function writer(): NoteWriter {
  return {
    // Read the live store every time: a queued capture must see the note an
    // earlier capture created, not the documents array from click time.
    findByPath: (path) =>
      useStore
        .getState()
        .documents.find((d) => d.path.replace(/\\/g, "/") === path),
    contentOf: (docId) => useStore.getState().getContent(docId),
    create: ({ type, path, content }) =>
      useStore.getState().createDoc({ type, path, content, open: false }),
    write: async (docId, content): Promise<CaptureWriteOutcome> => {
      // createDoc only touches memory; saveDocNow resolves once content/ has
      // accepted the body, so the caller can tell the truth about durability.
      // `force` skips the "unchanged → 已是最新" shortcut: a note created in
      // this same tick already holds its final body and still needs its first
      // write to disk.
      useStore.getState().setDraft(docId, content);
      const saved = await useStore.getState().saveDocNow(docId, { force: true });
      if (!saved.ok) {
        // A capture is all-or-nothing: leaving the rejected block in the draft
        // would make the next save write it anyway, contradicting the failure
        // the user was just shown. Roll the note back to its saved body.
        useStore.getState().discardDraft(docId);
        return { ok: false, message: saved.message };
      }
      return { ok: true };
    },
  };
}

export function captureExplainToLibrary(
  input: ExplainCaptureInput
): Promise<import("./capturePlan").CaptureResult> {
  return captureExplain(writer(), input);
}

export function captureSnippetToLibrary(
  input: SnippetCaptureInput
): Promise<import("./capturePlan").CaptureResult> {
  return captureSnippet(writer(), input);
}

/**
 * 「引用到笔记」: 有打开的笔记就追加进去，否则走既有 速记.md 通路。
 */
export function captureCitationToActiveNote(
  input: SnippetCaptureInput
): Promise<import("./capturePlan").CaptureResult> {
  const state = useStore.getState();
  const id = state.activeId;
  const doc = id ? state.documents.find((d) => d.id === id) : undefined;
  if (doc && doc.type === "md") {
    return captureSnippetIntoDoc(writer(), { id: doc.id, path: doc.path }, input);
  }
  return captureSnippet(writer(), input);
}

export function citationCaptureVerb(usedOpenNote: boolean): string {
  return usedOpenNote ? "已引用到当前笔记" : "已收入速记";
}

export function willCiteIntoOpenNote(): boolean {
  const state = useStore.getState();
  const id = state.activeId;
  const doc = id ? state.documents.find((d) => d.id === id) : undefined;
  return !!doc && doc.type === "md";
}

/** 「收入本段对话」：当前 thread 全文 → 一篇 讲解-<短标题>.md（整篇覆盖）。 */
export function captureExplainThreadToLibrary(
  input: ExplainThreadCaptureInput
): Promise<import("./capturePlan").CaptureResult> {
  return captureExplainThread(writer(), input);
}
