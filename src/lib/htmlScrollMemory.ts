import { readScrollMemoryPercent } from "./scrollMemory";

/** 与 Markdown 阅读位置同一套节奏：首帧高度不够时再试，不把 0 当结论。 */
export const HTML_SCROLL_RESTORE_RETRY_MS = [200, 500, 1200] as const;

/**
 * 「定位到源码」或测验跳转到指定题时让位，避免恢复把明确跳转顶走。
 * 与 Markdown 的 `yieldTo: !!pendingPreviewLocate` 对齐：只要有一次预览定位
 * 在途就让；测验只让给跳向「这一篇」的请求。
 */
export function shouldYieldHtmlScrollRestore(args: {
  pendingPreviewLocate: unknown | null | undefined;
  pendingQuizReveal: { docId: string } | null | undefined;
  docId: string;
}): boolean {
  if (args.pendingPreviewLocate) return true;
  if (args.pendingQuizReveal && args.pendingQuizReveal.docId === args.docId) {
    return true;
  }
  return false;
}

/**
 * 要恢复的百分比；没有记录、记录在顶部（<= 0）时返回 null，调用方应放弃恢复。
 */
export function restorePercentForPath(path: string): number | null {
  if (!path) return null;
  const percent = readScrollMemoryPercent(path);
  if (percent == null || percent <= 0) return null;
  return percent;
}
