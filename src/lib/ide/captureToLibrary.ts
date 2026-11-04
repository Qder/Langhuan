/**
 * 读码 → 藏书阁 的写入动作（B1 / B2）。
 *
 * The markdown shape and the "create vs append" decision live in pure modules
 * (`captureNote.ts` / `capturePlan.ts`); this file only binds them to the real
 * notes store — `createDoc` for a new note, `setDraft` + `saveDoc` to append.
 * No second storage layer, no direct content/ writes.
 */

"use client";

import { useStore } from "@/lib/store";
import {
  captureExplain,
  captureSnippet,
  captureStatusMessage,
  type CaptureResult,
  type ExplainCaptureInput,
  type NoteWriter,
  type SnippetCaptureInput,
} from "./capturePlan";

export type { CaptureResult, ExplainCaptureInput, SnippetCaptureInput };
export { captureStatusMessage };

function writer(): NoteWriter {
  const store = useStore.getState();
  return {
    findByPath: (path) =>
      store.documents.find((d) => d.path.replace(/\\/g, "/") === path),
    contentOf: (docId) => store.getContent(docId),
    create: ({ type, path, content }) =>
      store.createDoc({ type, path, content, open: false }),
    write: (docId, content) => {
      // createDoc only touches memory; persist so a refresh keeps the note.
      useStore.getState().setDraft(docId, content);
      void useStore.getState().saveDoc(docId);
    },
  };
}

export function captureExplainToLibrary(
  input: ExplainCaptureInput
): CaptureResult {
  return captureExplain(writer(), input);
}

export function captureSnippetToLibrary(
  input: SnippetCaptureInput
): CaptureResult {
  return captureSnippet(writer(), input);
}
