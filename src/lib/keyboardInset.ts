/**
 * 触屏软键盘占用的底部空间。
 *
 * 安卓 WebView / 移动 Chrome 默认改的是 visualViewport，不会把 `dvh` 布局
 * 视口一起缩小。讲解输入区贴在布局底部时会被键盘盖住。这里用
 * `innerHeight - (offsetTop + height)` 算出底部遮挡，小于阈值的变化（地址栏）
 * 忽略，避免页面跟着抖动。
 */

/** 小于这个高度的遮挡当作地址栏 / 工具条，不当成键盘。 */
export const KEYBOARD_INSET_IGNORE_BELOW_PX = 72;

export type VisualViewportBox = {
  height: number;
  offsetTop: number;
};

export function keyboardInsetPx(
  viewport: VisualViewportBox | null | undefined,
  layoutHeight: number
): number {
  if (!viewport) return 0;
  if (!Number.isFinite(viewport.height) || !Number.isFinite(viewport.offsetTop)) {
    return 0;
  }
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0 || viewport.height <= 0) {
    return 0;
  }
  const occluded = layoutHeight - (viewport.offsetTop + viewport.height);
  if (!Number.isFinite(occluded) || occluded <= KEYBOARD_INSET_IGNORE_BELOW_PX) {
    return 0;
  }
  return Math.round(occluded);
}
