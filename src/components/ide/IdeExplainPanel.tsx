"use client";
import * as React from "react";
import { useIdeStore } from "@/lib/ide/store";
import type { IdeExplainMessage } from "@/lib/ide/explain";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { IDE_EXPLAIN_DOCK_QUERY, IDE_WIDE_QUERY } from "@/lib/ide/panelLayers";
import { cn } from "@/lib/utils";
import { ExplainHeader } from "./explain/ExplainHeader";
import { ExplainDesktopHint } from "./explain/ExplainDesktopHint";
import { ExplainMessageList } from "./explain/ExplainMessageList";
import { ExplainComposer } from "./explain/ExplainComposer";
import { useExplainSend } from "./explain/useExplainSend";
import { usePendingExplain } from "./explain/usePendingExplain";
import { useExplainCapture } from "./explain/useExplainCapture";
import { useExplainJump } from "./explain/useExplainJump";
import { ExplainViewControls } from "./explain/ExplainViewControls";
import { ExplainSheet } from "./explain/ExplainSheet";
import {
  nextExplainSheetAfterJump,
  type ExplainSheetState,
} from "@/lib/ide/explainSheet";
/**
 * 讲解面板 — 只编排。
 *
 * 消息列表 / 输入区 / 收入藏书阁·速记 / 桌面设置说明 / pending 消费
 * 都在 `./explain/*`。这里负责宽屏侧栏 vs 窄屏抽屉，以及把 hooks 接到子件。
 */
export function IdeExplainPanel({ onClose }: { onClose: () => void }) {
  const isLg = useMediaQuery(IDE_EXPLAIN_DOCK_QUERY);
  const treeDocked = useMediaQuery(IDE_WIDE_QUERY);
  const treeWidth = useIdeStore((s) => s.explorerOpen ? s.explorerWidth : 0);
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const selection = useIdeStore((s) => s.selection);
  const explainBySession = useIdeStore((s) => s.explainBySession);
  const messages: IdeExplainMessage[] = React.useMemo(
    () => (session ? explainBySession[session.id] || [] : []),
    [session, explainBySession]
  );

  const [fullscreen, setFullscreen] = React.useState(false);
  const [sheet, setSheet] = React.useState<ExplainSheetState>("half");
  const jump = useExplainJump({
    onOpened: () => {
      // 窄屏跳转后编辑器必须可见：加高档自动收到半高，半高档不动。
      setFullscreen(false);
      setSheet((cur) => nextExplainSheetAfterJump(!isLg, cur, true));
    },
  });
  const stream = useExplainSend({
    onTurnStart: () => jump.clearJumpFeedback(),
  });
  usePendingExplain({
    sendRef: stream.sendRef,
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
  const explainWidth = useIdeStore((s) => s.explainWidth);

  const panel = (
    <div
      className={cn(
        "flex flex-col bg-[var(--chrome)] border-[var(--chrome-border)]",
        isLg
          ? fullscreen ? "fixed inset-0 z-[70] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" : "h-full shrink-0"
          : "w-full flex-1 min-h-0 rounded-t-2xl border-t shadow-2xl"
      )}
      style={isLg && !fullscreen ? { width: `min(${explainWidth}px, calc(100vw - ${treeDocked && treeWidth ? treeWidth + 296 : 288}px))` } : undefined}
      onKeyDown={(e) => { if (e.key === "Escape" && fullscreen) { e.stopPropagation(); setFullscreen(false); } }}
      aria-modal={fullscreen || undefined}
      role={isLg ? "dialog" : undefined}
      aria-label={isLg ? "讲解" : undefined}
    >
      <ExplainViewControls fullscreen={isLg ? fullscreen : sheet === "full"} onToggle={() => isLg ? setFullscreen((v) => !v) : setSheet((v) => v === "full" ? "half" : "full")} onCode={onClose} />
      <ExplainHeader
        isMock={stream.isMock}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onStop={stream.stop}
        onClose={onClose}
        onCaptureThread={() => void capture.captureThread()}
        savedThreadPath={capture.savedThread?.path}
        onOpenSavedThread={capture.openSavedThread}
      />
      {stream.phase && <p role="status" className="px-3 text-xs text-[var(--muted)]">{stream.phase}</p>}
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
        includeFolder={stream.includeFolder}
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
        onIncludeFolder={stream.setIncludeFolder}
        onSend={stream.send}
        onStop={stream.stop}
        onCaptureSelection={() => void capture.captureSelection()}
      />
    </div>
  );

  if (isLg) return panel;

  return (
    <ExplainSheet state={sheet} onState={setSheet} onClose={onClose}>
      {panel}
    </ExplainSheet>
  );
}
