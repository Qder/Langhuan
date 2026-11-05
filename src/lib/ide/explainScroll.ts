/** 距底部多少像素仍算「跟着滚」。 */
export const EXPLAIN_SCROLL_BOTTOM_PX = 80;

export function isNearExplainListBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  thresholdPx = EXPLAIN_SCROLL_BOTTOM_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

export type ExplainFollowEvent =
  | { type: "scroll"; nearBottom: boolean }
  | { type: "pointerdown" }
  | { type: "turn-start" }
  | { type: "turn-end"; nearBottom: boolean };

/**
 * 粘性跟滚：默认钉在底部；上滚或列表 pointerdown 暂停；
 * 回到底部后恢复；本轮结束只在仍靠近底部时恢复（不把早段阅读拽回去）。
 */
export function nextExplainFollowPin(
  _prev: boolean,
  event: ExplainFollowEvent
): boolean {
  switch (event.type) {
    case "scroll":
      return event.nearBottom;
    case "pointerdown":
      return false;
    case "turn-start":
      return true;
    case "turn-end":
      return event.nearBottom;
  }
}

export function shouldFollowExplainScroll(pinToBottom: boolean): boolean {
  return pinToBottom;
}
