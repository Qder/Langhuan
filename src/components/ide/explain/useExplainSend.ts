"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import {
  buildExplainFilePayloads,
  citationsFromMarkdown,
  collectFileIndexWithOptionalBfs,
  IDE_EXPLAIN_FOLDER_MAX_CHARS,
  IDE_EXPLAIN_FOLDER_MAX_CHARS_ANDROID,
  IDE_EXPLAIN_FOLDER_MAX_FILES,
  IDE_EXPLAIN_FOLDER_MAX_FILES_ANDROID,
  listNearbyImports,
  planExplainFolderFiles,
  rankExplainFolderPaths,
  selectExplainPriorMessages,
  truncateNeighborExplainContent,
  type IdeExplainMessage,
} from "@/lib/ide/explain";
import { createExplainDeltaFlusher } from "@/lib/ide/explainFlush";
import { streamExplain } from "@/lib/ide/explainClient";
import { finalizeExplainReply } from "@/lib/ide/explainTimeout";
import { listIdeDir, readIdeFile } from "@/lib/ide/ideFs";
import { isTauriAndroidRuntime } from "@/lib/platform";
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
  const [includeFolder, setIncludeFolder] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [isMock, setIsMock] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const sendRef = React.useRef<SendExplain>(async () => {});
  const flusherRef = React.useRef<ReturnType<typeof createExplainDeltaFlusher> | null>(
    null
  );
  const getFlusher = () => {
    if (!flusherRef.current) {
      flusherRef.current = createExplainDeltaFlusher((text, extra) => {
        useIdeStore.getState().updateLastAssistant(text, extra);
      });
    }
    return flusherRef.current;
  };

  const activeTab = tabs.find((t) => t.path === activePath) || null;

  const stop = () => {
    getFlusher().flushPending();
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

    if (useFile && !activeTab && !includeFolder) {
      // 勾了带上当前文件但没打开文件：不阻断，files 仍是 []，状态栏说一句。
      setStatus("未打开文件，本轮不带正文");
    }

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

    if (includeFolder) {
      const folderMaxFiles = isTauriAndroidRuntime()
        ? IDE_EXPLAIN_FOLDER_MAX_FILES_ANDROID
        : IDE_EXPLAIN_FOLDER_MAX_FILES;
      const folderMaxChars = isTauriAndroidRuntime()
        ? IDE_EXPLAIN_FOLDER_MAX_CHARS_ANDROID
        : IDE_EXPLAIN_FOLDER_MAX_CHARS;
      const already = new Set(files.map((f) => f.path));
      const ranked = rankExplainFolderPaths(
        fileIndex,
        activeTab?.path ?? activePath
      );
      const cache = new Map<string, string>();
      const skipped: string[] = [];
      for (const rel of ranked) {
        if (already.has(rel)) continue;
        if (cache.size >= folderMaxFiles) break;
        const open = tabs.find((t) => t.path === rel);
        if (open) {
          cache.set(rel, open.draft);
          continue;
        }
        try {
          cache.set(rel, await readIdeFile(session, rel));
        } catch {
          skipped.push(rel);
        }
      }
      const folder = planExplainFolderFiles({
        enabled: true,
        fileIndex,
        alreadyPaths: [...already],
        activePath: activeTab?.path ?? activePath,
        maxFiles: folderMaxFiles,
        maxChars: folderMaxChars,
        readContent: (rel) => cache.get(rel) ?? null,
      });
      files = [...files, ...folder.files];
      if (folder.files.length > 0) {
        const extra =
          folder.omitted > 0
            ? `（另有 ${folder.omitted} 个未纳入）`
            : "";
        setStatus(`本轮带上工程内 ${folder.files.length} 个文件正文${extra}`);
      } else if (files.length === 0) {
        setStatus("未读到可带的工程文件正文");
      }
      if (skipped.length > 0 && folder.files.length === 0) {
        setStatus(
          `未读到 ${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? "…" : ""}`
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
            getFlusher().schedule(acc);
          },
          onDone: ({ mock }) => {
            setIsMock(mock);
            const text = finalizeExplainReply(acc);
            getFlusher().now(text, { mock });
            // Citations snapshot so chips survive a reload.
            void citationsFromMarkdown(text);
          },
        }
      );
    } catch (e) {
      if (ac.signal.aborted) {
        getFlusher().flushPending();
        setStatus("已停止生成");
      } else {
        getFlusher().cancel();
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
    includeFolder,
    setIncludeFolder,
    busy,
    isMock,
    send,
    stop,
    sendRef,
  };
}
