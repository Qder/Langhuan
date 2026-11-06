/**
 * 打字机滚动的纯计算部分。
 *
 * 只做「把某个内容坐标摆到视口某个高度」这一件事，不碰 DOM、不读 store，
 * 这样两端（CodeMirror 源码、混合模式 textarea）共用同一套边界处理，
 * 也方便单独钉住「不会滚出可滚动范围」这类容易出 bug 的地方。
 */

/** 目标位置：视口中线略偏上。整行居中时视线落点更自然，也不至于把下文压掉。 */
export const TYPEWRITER_ANCHOR_RATIO = 0.45;

/** 小于这个位移就当作「已经在中线附近」，避免每次按键都做亚像素抖动。 */
export const TYPEWRITER_MIN_DELTA_PX = 2;

/**
 * 计算把 `contentY` 摆到视口 `ratio` 高度所需的 scrollTop。
 *
 * @param contentY 目标内容在滚动容器内的坐标（= 元素 viewport top - 容器 top + scrollTop）
 * @param ratio     0 = 顶部，1 = 底部；默认 0.45
 * @returns 夹紧到 [0, max] 的 scrollTop；容器不可滚动时返回当前值
 */
export function centeredScrollTop(
  contentY: number,
  clientHeight: number,
  scrollHeight: number,
  ratio = TYPEWRITER_ANCHOR_RATIO
): number {
  // `Math.max(0, NaN)` 是 NaN，而把 NaN 写进 scrollTop 会被浏览器当成 0 或直接忽略，
  // 症状是「打字时视口偶尔跳回顶部」——所以先挡掉非有限输入。
  if (
    !Number.isFinite(contentY) ||
    !Number.isFinite(clientHeight) ||
    !Number.isFinite(scrollHeight)
  ) {
    return 0;
  }
  const max = Math.max(0, scrollHeight - clientHeight);
  const clampRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : TYPEWRITER_ANCHOR_RATIO;
  const next = contentY - clientHeight * clampRatio;
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.min(max, next));
}

/**
 * 是否需要真的滚动。用阈值而不是 `!==`：
 * CM6 的行高会随字体/折行变化，亚像素抖动不值得触发一次 reflow。
 */
export function shouldRecenter(
  current: number,
  next: number,
  minDelta = TYPEWRITER_MIN_DELTA_PX
): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(next)) return false;
  return Math.abs(next - current) > minDelta;
}

/**
 * 文档末尾的留白：打字机模式需要半屏空白，否则最后一行永远到不了中线。
 *
 * 返回值保证不小于默认的 40vh 观感——半屏比 40vh 大，所以打开后只会变高；
 * 视口异常时退回 0，交给调用方沿用原来的 padding。
 */
export function typewriterBottomPad(clientHeight: number): number {
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return 0;
  const half = Math.ceil(clientHeight / 2 / 8) * 8;
  const defaultPad = Math.ceil((clientHeight * 0.4) / 8) * 8;
  return Math.max(half, defaultPad);
}
