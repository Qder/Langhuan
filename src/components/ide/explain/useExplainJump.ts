"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import type { IdeCitation } from "@/lib/ide/citations";
import { locateExplainFence } from "@/lib/ide/snippetJump";
import type { ExplainFence } from "@/lib/ide/snippetLocate";
import { readIdeFile } from "@/lib/ide/ideFs";
import {
  formatExplainMissStatus,
  formatExplainOpenedStatus,
  runExplainCitationJump,
} from "@/lib/ide/explainJump";
import type { ExplainCandidate } from "./types";

export type ExplainJumpNotice = {
  path: string;
  message: string;
};

/** Open a citation / fence in the editor; collect basename candidates on miss. */
export function useExplainJump() {
  const session = useIdeStore((s) => s.session);
  const tabs = useIdeStore((s) => s.tabs);
  const children = useIdeStore((s) => s.children);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);
  const [candidates, setCandidates] = React.useState<ExplainCandidate[]>([]);
  const [jumpNotice, setJumpNotice] = React.useState<ExplainJumpNotice | null>(
    null
  );
  const [failedCitePath, setFailedCitePath] = React.useState<string | null>(null);
  const cycleRef = React.useRef<{ key: string; index: number } | null>(null);

  const clearJumpFeedback = React.useCallback(() => {
    setCandidates([]);
    setJumpNotice(null);
    setFailedCitePath(null);
  }, []);

  const applyOpened = React.useCallback(
    (path: string, line?: number, endLine?: number) => {
      setCandidates([]);
      setJumpNotice(null);
      setFailedCitePath(null);
      setStatus(formatExplainOpenedStatus(path, line, endLine));
    },
    [setStatus]
  );

  const applyMiss = React.useCallback(
    (citePath: string, list: string[], message: string) => {
      setFailedCitePath(citePath);
      setCandidates(list.map((path) => ({ path })));
      setJumpNotice({ path: citePath, message });
      setStatus(message);
    },
    [setStatus]
  );

  const jumpCitation = React.useCallback(
    async (c: IdeCitation) => {
      const result = await runExplainCitationJump(c, { children, openFile });
      if (result.ok) {
        applyOpened(result.path, result.line, result.endLine);
        return;
      }
      applyMiss(c.path, result.candidates, result.message);
    },
    [applyMiss, applyOpened, children, openFile]
  );

  const pickCandidate = React.useCallback(
    async (p: ExplainCandidate) => {
      const ok = await openFile(p.path, { line: p.line, endLine: p.endLine });
      if (ok) {
        applyOpened(p.path, p.line, p.endLine);
        return;
      }
      applyMiss(p.path, [], formatExplainMissStatus(p.path, []));
    },
    [applyMiss, applyOpened, openFile]
  );

  const jumpFence = React.useCallback(
    async (f: ExplainFence, msgId?: string) => {
      const tabFiles = tabs.map((t) => ({
        path: t.path,
        content: t.draft,
        startLine: 1,
      }));
      const sid = useIdeStore.getState().session?.id;
      const snapshot =
        msgId && sid
          ? useIdeStore.getState().explainBySession[sid]?.find((m) => m.id === msgId)
              ?.files
          : undefined;

      const located = await locateExplainFence({
        fence: f,
        snapshot,
        tabs: tabFiles,
        readFile: session
          ? async (path) => readIdeFile(session, path)
          : undefined,
      });

      if (!located.ok) {
        cycleRef.current = null;
        if (f.path && f.line == null) {
          await jumpCitation({
            path: f.path,
            line: f.line,
            endLine: f.endLine,
            raw: f.body,
            index: f.index,
            endIndex: f.endIndex,
          });
          return;
        }
        if (f.path && f.line != null) {
          setCandidates([{ path: f.path, line: f.line, endLine: f.endLine }]);
          setStatus(
            `代码块与 ${f.path}:${f.line} 对不上；点候选仍可打开文件`
          );
          return;
        }
        if (located.reason === "too-short" || located.reason === "empty") {
          setCandidates([]);
          setStatus("代码块太短，无法可靠定位");
          return;
        }
        setCandidates([]);
        setStatus("工程里找不到这段代码");
        return;
      }

      const hits = located.hits;
      const key = `${msgId ?? ""}:${f.index}:${f.body}`;
      let index = 0;
      if (hits.length > 1 && cycleRef.current?.key === key) {
        index = (cycleRef.current.index + 1) % hits.length;
      }
      cycleRef.current = { key, index };
      const hit = hits[index]!;
      setCandidates(
        hits.length > 1
          ? hits.map((h) => ({
              path: h.path,
              line: h.line,
              endLine: h.endLine,
            }))
          : []
      );
      const ok = await openFile(hit.path, {
        line: hit.line,
        endLine: hit.endLine,
      });
      if (!ok) {
        setStatus(`工程里找不到 ${hit.path}`);
        return;
      }
      const how = hit.precision === "exact" ? "精确" : "忽略空白";
      if (hits.length > 1) {
        setStatus(
          `已定位 ${hit.path}:${hit.line}（${index + 1}/${hits.length}，再点下一处）`
        );
      } else {
        setStatus(`已定位 ${hit.path}:${hit.line}（${how}）`);
      }
    },
    [jumpCitation, openFile, session, setStatus, tabs]
  );

  return {
    candidates,
    setCandidates,
    jumpNotice,
    failedCitePath,
    jumpCitation,
    jumpFence,
    pickCandidate,
    clearJumpFeedback,
    openFile,
  };
}
