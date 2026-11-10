"use client";

import * as React from "react";
import {
  explainSheetHasScrim,
  explainSheetHeightStyle,
  explainSheetToggleLabel,
  toggleExplainSheet,
  type ExplainSheetState,
} from "@/lib/ide/explainSheet";
import { useKeyboardInset } from "@/lib/useKeyboardInset";

/**
 * 窄屏讲解抽屉的外壳：半高默认、抓手切换高度、只有加高档铺遮罩。
 *
 * 半高时遮罩不渲染，顶栏 Tab / 编辑器上半段仍可点；加高档才盖住背后，
 * 点遮罩关讲解。宽度判断和互斥语义留在 IdeShell / panelLayers。
 */
export function ExplainSheet({
  state,
  onState,
  onClose,
  children,
}: {
  state: ExplainSheetState;
  onState: (next: ExplainSheetState) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const keyboardInset = useKeyboardInset();
  return (
    <>
      {explainSheetHasScrim(state) && (
        <button
          type="button"
          className="absolute inset-0 z-40 bg-black/35"
          aria-label="关闭讲解"
          onClick={onClose}
        />
      )}
      <div
        className={state === "full"
          ? "fixed inset-0 z-[70] flex flex-col min-h-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          : "absolute inset-x-0 bottom-0 z-50 flex flex-col min-h-0 animate-enter"}
        style={explainSheetHeightStyle(state, keyboardInset)}
        data-keyboard-inset={keyboardInset > 0 ? keyboardInset : undefined}
        aria-modal={state === "full" || undefined}
        role="dialog"
        aria-label="讲解"
      >
        <button
          type="button"
          className="shrink-0 flex items-center justify-center h-6 w-full border-b border-[var(--chrome-border)] bg-[var(--chrome)]"
          aria-label={explainSheetToggleLabel(state)}
          title={explainSheetToggleLabel(state)}
          onClick={() => onState(toggleExplainSheet(state))}
        >
          <span className="h-1 w-10 rounded-full bg-[var(--muted)] opacity-50" />
        </button>
        {children}
      </div>
    </>
  );
}
