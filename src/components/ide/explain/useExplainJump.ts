"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import {
  planIdeCitationJump,
  resolveIdeCitation,
  type IdeCitation,
} from "@/lib/ide/citations";
import { locateExplainFence } from "@/lib/ide/snippetJump";
import type { ExplainFence } from "@/lib/ide/snippetLocate";
import { readIdeFile } from "@/lib/ide/ideFs";
import type { ExplainCandidate } from "./types";

/** Open a citation / fence in the editor; collect basename candidates on miss. */
export function useExplainJump() {
  const session = useIdeStore((s) => s.session);
  const tabs = useIdeStore((s) => s.tabs);
  const children = useIdeStore((s) => s.children);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);
  const [candidates, setCandidates] = React.useState<ExplainCandidate[]>([]);
  const cycleRef = React.useRef<{ key: string; index: number } | null>(null);

  const jumpCitation = React.useCallback(
    async (c: IdeCitation) => {
      const plan = planIdeCitationJump(c.path, children);
      const lineOpts = { line: c.line, endLine: c.endLine };

      const failWith = (list: string[]) => {
        setCandidates(list.map((path) => ({ path })));
        if (list.length === 0) {
          setStatus(`工程里找不到 ${c.path}`);
        } else {
          setStatus(`工程里找不到 ${c.path}；同名候选：${list.join("、")}`);
        }
      };

      if (plan.kind === "miss") {
        failWith([]);
        return;
      }

      if (plan.kind === "candidates") {
        failWith(plan.candidates);
        return;
      }

      if (plan.kind === "open") {
        setCandidates([]);
        const ok = await openFile(plan.path, lineOpts);
        if (!ok) failWith([]);
        return;
      }

      // try-exact: open via readIdeFile even if explorer never listed the folder
      const ok = await openFile(plan.path, { ...lineOpts, softFail: true });
      if (ok) {
        setCandidates([]);
        return;
      }

      // Fall back to basename among already-scanned children
      const resolved = resolveIdeCitation(c.path, children);
      if (resolved.ok) {
        setCandidates([]);
        const ok2 = await openFile(resolved.path, lineOpts);
        if (!ok2) failWith([]);
        return;
      }
      failWith(resolved.candidates);
    },
    [children, openFile, setStatus]
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

  return { candidates, setCandidates, jumpCitation, jumpFence, openFile };
}
