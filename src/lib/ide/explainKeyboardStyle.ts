/**
 * 宽屏停靠 / 全屏讲解在软键盘弹起时把输入区抬到键盘上方。
 * 窄屏抽屉改走 explainSheetHeightStyle 的 bottom，避免两处各加一次垫高。
 */
export function explainDockKeyboardPadding(
  docked: boolean,
  keyboardInsetPx: number
): string | undefined {
  if (!docked) return undefined;
  if (!Number.isFinite(keyboardInsetPx) || keyboardInsetPx <= 0) return undefined;
  return `max(${Math.round(keyboardInsetPx)}px, env(safe-area-inset-bottom))`;
}
