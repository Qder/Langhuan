/**
 * 打字机滚动的 DOM 侧封装。
 *
 * 两处调用方：CodeMirror 源码编辑器与混合模式的 textarea。
 * 只做「量一下 → 算出 scrollTop → 真需要才写」，
 * 不自己去监听输入，避免和各自的输入链路抢职责。
 */

import { centeredScrollTop, shouldRecenter, typewriterBottomPad } from "./typewriter";

export type ScrollHostMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function readScrollHostMetrics(el: HTMLElement | null): ScrollHostMetrics | null {
  if (!el) return null;
  const { scrollTop, clientHeight, scrollHeight } = el;
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return null;
  return { scrollTop, clientHeight, scrollHeight };
}

/**
 * 把一个元素滚到滚动容器的 45% 高度处。
 * 返回是否真的改了 scrollTop（调用方据此决定要不要开忽略窗）。
 */
export function scrollElementToTypewriterAnchor(
  scroller: HTMLElement | null,
  target: HTMLElement | null,
  ratio?: number
): boolean {
  const metrics = readScrollHostMetrics(scroller);
  if (!scroller || !target || !metrics) return false;
  const scrollRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  // 用 rect 差值算，避免 offsetParent 链上多套定位带来的 off-by-scrollTop。
  const contentY = targetRect.top - scrollRect.top + metrics.scrollTop;
  const next = centeredScrollTop(
    contentY,
    metrics.clientHeight,
    metrics.scrollHeight,
    ratio
  );
  if (!shouldRecenter(metrics.scrollTop, next)) return false;
  scroller.scrollTop = next;
  return true;
}

/**
 * textarea 内的光标行 → 内容坐标（相对 textarea 内容区顶部，含 padding/border）。
 *
 * textarea 只有一个滚动容器、没有子节点可以量，所以用「行号 × 行高」估算。
 * 这里返回的是**内容坐标**，不含 scrollTop：滚动目标由 `centeredScrollTop` 算，
 * 若在这里再减一次 scrollTop 就会把当前滚动位置算两遍（表现是越滚越远）。
 */
export function estimateTextareaCaretY(
  ta: HTMLTextAreaElement,
  caretOffset: number
): number | null {
  if (!Number.isFinite(caretOffset)) return null;
  const style = window.getComputedStyle(ta);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const before = ta.value.slice(0, Math.max(0, Math.min(caretOffset, ta.value.length)));
  const lineIndex = before.split("\n").length - 1;
  return paddingTop + borderTop + lineIndex * lineHeight;
}

/** 把 textarea 的光标行摆到自身 45% 高度处。 */
export function centerTextareaCaret(ta: HTMLTextAreaElement | null): boolean {
  if (!ta) return false;
  if (ta.clientHeight <= 0) return false;
  const caret = ta.selectionStart;
  const caretY = estimateTextareaCaretY(ta, caret);
  if (caretY == null) return false;
  const next = centeredScrollTop(caretY, ta.clientHeight, ta.scrollHeight);
  if (!shouldRecenter(ta.scrollTop, next)) return false;
  ta.scrollTop = next;
  return true;
}

/**
 * 给滚动容器补半屏留白（用 padding-bottom），让最后一块/最后一行也能滚到中线。
 * 关掉时把内联样式清掉，交还给原来的 CSS。
 */
export function applyTypewriterBottomPad(
  el: HTMLElement | null,
  enabled: boolean
): void {
  if (!el) return;
  if (!enabled) {
    el.style.removeProperty("padding-bottom");
    return;
  }
  const pad = typewriterBottomPad(el.clientHeight);
  if (pad <= 0) {
    el.style.removeProperty("padding-bottom");
    return;
  }
  el.style.paddingBottom = `${pad}px`;
}
