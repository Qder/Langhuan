"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import {
  adoptExplainDraft,
  snapshotExplainDraft,
  subscribeExplainDrafts,
  writeExplainDraft,
} from "@/lib/ide/explainDraft";

type QuestionSetter = (value: string | ((prev: string) => string)) => void;

/**
 * 讲解输入草稿：关面板卸载、换对话、刷新后仍恢复未发送的文字。
 * 发送成功后由调用方把值写成空串，本钩子会删掉对应记录。
 */
export function useExplainComposerDraft(): [string, QuestionSetter] {
  const sessionId = useIdeStore((s) => s.session?.id ?? "");
  const threadId = useIdeStore((s) =>
    s.session?.id ? s.explainActiveThreadIdBySession[s.session.id] ?? "" : ""
  );
  const getSnapshot = React.useCallback(
    () => snapshotExplainDraft(sessionId, threadId),
    [sessionId, threadId]
  );
  const question = React.useSyncExternalStore(
    subscribeExplainDrafts,
    getSnapshot,
    () => ""
  );

  React.useEffect(() => {
    if (sessionId && threadId) adoptExplainDraft(sessionId, "", threadId);
  }, [sessionId, threadId]);

  const setQuestion: QuestionSetter = React.useCallback(
    (value) => {
      const current = snapshotExplainDraft(sessionId, threadId);
      const next = typeof value === "function" ? value(current) : value;
      writeExplainDraft(sessionId, threadId, next);
      if (threadId) writeExplainDraft(sessionId, "", "");
    },
    [sessionId, threadId]
  );

  return [question, setQuestion];
}
