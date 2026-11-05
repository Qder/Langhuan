/**
 * 讲解输入框按键：Enter 发送，Shift+Enter 换行。
 * 拼音未上屏（isComposing / keyCode 229）时不要当成发送。
 */

export type ExplainComposerKeyEvent = {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export function isExplainComposerComposing(e: ExplainComposerKeyEvent): boolean {
  if (e.isComposing || e.nativeEvent?.isComposing) return true;
  const code = e.keyCode ?? e.nativeEvent?.keyCode;
  return code === 229;
}

/**
 * 这一击应视为「发送」：裸 Enter 或 Ctrl/⌘+Enter。
 * Shift+Enter / Alt+Enter / IME 确认键返回 false（让浏览器换行或上屏）。
 */
export function shouldSendOnExplainComposerKey(e: ExplainComposerKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey) return false;
  if (isExplainComposerComposing(e)) return false;
  return true;
}
