"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import { citationsFromMarkdown, type IdeExplainMessage } from "@/lib/ide/explain";
import {
  captureExplainToLibrary,
  captureSnippetToLibrary,
  captureStatusMessage,
} from "@/lib/ide/captureToLibrary";
import { useStore } from "@/lib/store";

/** Persist an answer into 读码笔记, or the live selection into 速记.md. */
export function useExplainCapture(messages: IdeExplainMessage[]) {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const tabs = useIdeStore((s) => s.tabs);
  const selection = useIdeStore((s) => s.selection);
  const setStatus = useIdeStore((s) => s.setStatus);
  const [savedNotes, setSavedNotes] = React.useState<
    Record<string, { docId: string; path: string }>
  >({});

  /** B1 — the question that produced this answer is the previous user turn. */
  const captureExplain = React.useCallback(
    async (msg: IdeExplainMessage) => {
      const idx = messages.findIndex((m) => m.id === msg.id);
      const question =
        [...messages.slice(0, idx < 0 ? 0 : idx)]
          .reverse()
          .find((m) => m.role === "user")?.content ?? "";
      const result = await captureExplainToLibrary({
        question,
        answer: msg.content,
        projectName: session?.name,
        sourcePath: activePath,
        // Land the file link on the line the question was about, when known.
        sourceLine:
          selection && selection.path === activePath
            ? selection.fromLine
            : undefined,
        citations: msg.citations ?? citationsFromMarkdown(msg.content),
        createdAt: msg.createdAt,
      });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      setSavedNotes((prev) => ({
        ...prev,
        [msg.id]: { docId: result.docId, path: result.path },
      }));
      setStatus(captureStatusMessage(result));
    },
    [activePath, messages, selection, session?.name, setStatus]
  );

  const openSavedNote = React.useCallback(
    (msgId: string) => {
      const docId = savedNotes[msgId]?.docId;
      if (!docId) return;
      useStore.getState().setAppMode("notes");
      window.setTimeout(() => {
        useStore.getState().requestOpenDoc(docId);
      }, 30);
    },
    [savedNotes]
  );

  /** B2 — append the live editor selection to 读码笔记/速记.md. */
  const captureSelection = React.useCallback(async () => {
    if (!selection || selection.path !== activePath) {
      setStatus("先在编辑器里选中一段代码");
      return;
    }
    const tab = tabs.find((t) => t.path === selection.path);
    const fromDraft = tab
      ? tab.draft
          .replace(/\r\n/g, "\n")
          .split("\n")
          .slice(selection.fromLine - 1, selection.toLine)
          .join("\n")
      : "";
    const text = selection.text ?? fromDraft;
    if (!text.trim()) {
      setStatus("选区是空的");
      return;
    }
    // Success is reported by the capture only after 速记.md is on disk, so a
    // failed persist leaves the failure message visible instead.
    const result = await captureSnippetToLibrary({
      path: selection.path,
      fromLine: selection.fromLine,
      toLine: selection.toLine,
      text,
      lang: selection.path.split(".").pop() ?? "",
    });
    setStatus(
      result.ok
        ? captureStatusMessage(result, "已收入速记")
        : result.message
    );
  }, [activePath, selection, setStatus, tabs]);

  return {
    savedNotes,
    captureExplain,
    openSavedNote,
    captureSelection,
  };
}
