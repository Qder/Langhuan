"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import {
  buildExplainFilePayloads,
  citationsFromMarkdown,
  collectFileIndexWithOptionalBfs,
  listNearbyImports,
  selectExplainPriorMessages,
  truncateNeighborExplainContent,
  type IdeExplainMessage,
} from "@/lib/ide/explain";
import { streamExplain } from "@/lib/ide/explainClient";
import { listIdeDir, readIdeFile } from "@/lib/ide/ideFs";
import type { SendExplain } from "./types";

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Assemble context, stream a turn, expose include-flag state for the composer. */
export function useExplainSend({
  onTurnStart,
}: { onTurnStart?: () => void } = {}) {
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const tabs = useIdeStore((s) => s.tabs);
  const selection = useIdeStore((s) => s.selection);
  const children = useIdeStore((s) => s.children);
  const setStatus = useIdeStore((s) => s.setStatus);
  const pushExplainMessage = useIdeStore((s) => s.pushExplainMessage);
  const updateLastAssistant = useIdeStore((s) => s.updateLastAssistant);
  const explainSettings = useIdeStore((s) => s.explainSettings);

  const [question, setQuestion] = React.useState("");
  const [includeFile, setIncludeFile] = React.useState(true);
  const [includeSelection, setIncludeSelection] = React.useState(false);
  const [includeNearby, setIncludeNearby] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [isMock, setIsMock] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const sendRef = React.useRef<SendExplain>(async () => {});

  const activeTab = tabs.find((t) => t.path === activePath) || null;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async (
    preset?: string,
    opts?: { includeFile?: boolean; includeSelection?: boolean }
  ) => {
    if (!session) {
      setStatus("请先打开文件夹");
      return;
    }
    const q = (preset ?? question).trim();
    if (!q || busy) return;

    const useFile = opts?.includeFile ?? includeFile;
    const useSel = opts?.includeSelection ?? includeSelection;

    let files =
      activeTab && (useFile || useSel)
        ? buildExplainFilePayloads({
            path: activeTab.path,
            content: activeTab.draft,
            includeFile: useFile,
            includeSelection:
              useSel &&
              !!selection &&
              selection.path === activeTab.path,
            selection:
              selection && selection.path === activeTab.path ? selection : null,
          })
        : [];

    // Need scanned paths before Java package-import matching.
    const fileIndex = await collectFileIndexWithOptionalBfs({
      session,
      children,
      listDir: listIdeDir,
    });

    // Neighbors ≤3: relative imports first, then unique Java package hits.
    // Truncation: ≤400 lines full; else head 160.
    if (activeTab && includeNearby && (useFile || useSel)) {
      const already = new Set(files.map((f) => f.path));
      const skipped: string[] = [];
      for (const rel of listNearbyImports(
        activeTab.path,
        activeTab.draft,
        fileIndex
      )) {
        if (already.has(rel)) continue;
        const open = tabs.find((t) => t.path === rel);
        let body: string | null = open ? open.draft : null;
        if (body == null) {
          try {
            body = await readIdeFile(session, rel);
          } catch {
            skipped.push(rel);
            continue;
          }
        }
        const trimmed = truncateNeighborExplainContent(body);
        files = [
          ...files,
          { path: rel, content: trimmed.content, startLine: trimmed.startLine },
        ];
        already.add(rel);
      }
      if (skipped.length > 0) {
        setStatus(
          `未读到 ${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? "…" : ""}，仍只用当前文件`
        );
      }
    }

    // 必须在 push 本轮气泡之前快照：否则会把空助手气泡和本轮 user 再塞进 prior。
    const prior = selectExplainPriorMessages(
      useIdeStore.getState().explainBySession[session.id] ?? []
    );

    const userMsg: IdeExplainMessage = {
      id: newId(),
      role: "user",
      content: q,
      createdAt: Date.now(),
    };
    const assistantId = newId();
    pushExplainMessage(userMsg);
    pushExplainMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      files: files.map((f) => ({ ...f })),
    });
    setQuestion("");
    setBusy(true);
    setIsMock(false);
    onTurnStart?.();

    const ac = new AbortController();
    abortRef.current = ac;

    // 桌面版没有 Next Route Handler，但可以直连用户自己配置的 OpenAI 兼容
    // 端点（Rust `ide_explain`）。prompt / mock 仍来自 explain.ts，两条通路
    // 共用同一份语义，见 src/lib/ide/explainClient.ts。
    try {
      let acc = "";
      await streamExplain(
        {
          question: q,
          files,
          fileIndex,
          prior,
          apiKey: explainSettings.apiKey,
          baseUrl: explainSettings.baseUrl,
          model: explainSettings.model,
          signal: ac.signal,
        },
        {
          onDelta: (text) => {
            acc += text;
            updateLastAssistant(acc, { mock: false });
          },
          onDone: ({ mock }) => {
            setIsMock(mock);
            updateLastAssistant(acc, { mock });
            // Citations snapshot so chips survive a reload.
            void citationsFromMarkdown(acc);
          },
        }
      );
    } catch (e) {
      if (ac.signal.aborted) {
        setStatus("已停止生成");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        updateLastAssistant(`（${msg}）`);
        setStatus(msg);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  // send 只属于事件/副作用：把 ref 赋值放进 effect，渲染期间不碰 ref
  // （React Compiler: react-hooks/refs）。
  React.useEffect(() => {
    sendRef.current = send;
  });

  return {
    question,
    setQuestion,
    includeFile,
    setIncludeFile,
    includeSelection,
    setIncludeSelection,
    includeNearby,
    setIncludeNearby,
    busy,
    isMock,
    send,
    stop,
    sendRef,
  };
}
