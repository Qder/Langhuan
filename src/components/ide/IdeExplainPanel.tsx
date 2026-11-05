"use client";

import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import type { IdeExplainMessage } from "@/lib/ide/explain";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { IDE_WIDE_QUERY } from "@/lib/ide/panelLayers";
import { cn } from "@/lib/utils";
import { ExplainHeader } from "./explain/ExplainHeader";
import { ExplainDesktopHint } from "./explain/ExplainDesktopHint";
import { ExplainMessageList } from "./explain/ExplainMessageList";
import { ExplainComposer } from "./explain/ExplainComposer";
import { useExplainSend } from "./explain/useExplainSend";
import { usePendingExplain } from "./explain/usePendingExplain";
import { useExplainCapture } from "./explain/useExplainCapture";
import { useExplainJump } from "./explain/useExplainJump";

/**
 * 讲解面板 — 只编排。
 *
 * 消息列表 / 输入区 / 收入藏书阁·速记 / 桌面设置说明 / pending 消费
 * 都在 `./explain/*`。这里负责宽屏侧栏 vs 窄屏抽屉，以及把 hooks 接到子件。
 */
export function IdeExplainPanel({ onClose }: { onClose: () => void }) {
  const isLg = useMediaQuery(IDE_WIDE_QUERY);
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const selection = useIdeStore((s) => s.selection);
  const explainBySession = useIdeStore((s) => s.explainBySession);
  const clearExplainHistory = useIdeStore((s) => s.clearExplainHistory);

  const messages: IdeExplainMessage[] = React.useMemo(
    () => (session ? explainBySession[session.id] || [] : []),
    [session, explainBySession]
  );

  const jump = useExplainJump();
  const stream = useExplainSend({
    onTurnStart: () => jump.clearJumpFeedback(),
  });
  usePendingExplain({
    sendRef: stream.sendRef,
    setIncludeFile: stream.setIncludeFile,
    setIncludeSelection: stream.setIncludeSelection,
  });
  const capture = useExplainCapture(messages);
  const onCite = React.useCallback(
    (c: Parameters<typeof jump.jumpCitation>[0]) => {
      void jump.jumpCitation(c);
    },
    [jump.jumpCitation]
  );
  const onFence = React.useCallback(
    (f: Parameters<typeof jump.jumpFence>[0], msgId?: string) => {
      void jump.jumpFence(f, msgId);
    },
    [jump.jumpFence]
  );

  const [showSettings, setShowSettings] = React.useState(false);
  const selectionActive = !!selection && selection.path === activePath;

  const panel = (
    <div
      className={cn(
        "flex flex-col bg-[var(--chrome)] border-[var(--chrome-border)]",
        isLg
          ? "w-[min(380px,38vw)] h-full border-l"
          : "w-full max-h-[min(70dvh,100dvh)] min-h-0 rounded-t-2xl border-t shadow-2xl"
      )}
      role="dialog"
      aria-label="讲解"
    >
      <ExplainHeader
        isMock={stream.isMock}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onClear={() => clearExplainHistory()}
        onClose={onClose}
      />
      {showSettings && <ExplainDesktopHint />}
      <ExplainMessageList
        hasSession={!!session}
        messages={messages}
        busy={stream.busy}
        activePath={activePath}
        candidates={jump.candidates}
        jumpNotice={jump.jumpNotice}
        failedCitePath={jump.failedCitePath}
        savedNotes={capture.savedNotes}
        onSend={stream.send}
        onCite={onCite}
        onFence={onFence}
        onCapture={capture.captureExplain}
        onOpenSaved={capture.openSavedNote}
        onPickCandidate={(p) => {
          void jump.pickCandidate(p);
        }}
      />
      <ExplainComposer
        hasSession={!!session}
        emptyHistory={messages.length === 0}
        busy={stream.busy}
        question={stream.question}
        includeFile={stream.includeFile}
        includeSelection={stream.includeSelection}
        includeNearby={stream.includeNearby}
        selectionActive={selectionActive}
        selectionRange={
          selectionActive && selection
            ? {
                path: selection.path,
                fromLine: selection.fromLine,
                toLine: selection.toLine,
              }
            : null
        }
        onQuestion={stream.setQuestion}
        onIncludeFile={stream.setIncludeFile}
        onIncludeSelection={stream.setIncludeSelection}
        onIncludeNearby={stream.setIncludeNearby}
        onSend={stream.send}
        onStop={stream.stop}
        onCaptureSelection={() => void capture.captureSelection()}
      />
    </div>
  );

  if (isLg) return panel;

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-40 bg-black/35"
        aria-label="关闭讲解"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 z-50 max-h-[min(70dvh,100dvh)] flex flex-col min-h-0 animate-enter">
        {panel}
      </div>
    </>
  );
}
