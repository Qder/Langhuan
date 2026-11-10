/**
 * 文库列表用的阅读进度展示。位置仍只存在 lh.mdScroll，不进 zustand。
 * 没有记录或还在开头附近时不显示，避免虚构「读完」或「0%」。
 */
import {
  MD_SCROLL_STORAGE_KEY,
  readScrollMemory,
  subscribeScrollMemory,
  type ScrollMemoryEntry,
} from "./scrollMemory";

/** 小于这个比例视为还在开头，列表里不画进度。 */
export const READING_PROGRESS_MIN_RATIO = 0.02;

export function visibleReadingPercent(
  entry: ScrollMemoryEntry | null | undefined
): number | null {
  if (!entry || !Number.isFinite(entry.ratio)) return null;
  if (entry.ratio < READING_PROGRESS_MIN_RATIO) return null;
  return Math.min(100, Math.max(0, Math.round(entry.ratio * 100)));
}

export function visibleReadingPercentForPath(path: string): number | null {
  if (!path) return null;
  return visibleReadingPercent(readScrollMemory(path));
}

export function formatReadingPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

/**
 * 订阅本页记忆变化和跨标签 storage 事件，返回一个递增版本号。
 * 列表用它在刷新后重读进度，不把进度写入 store。
 */
export function subscribeReadingProgress(onChange: () => void): () => void {
  const unsub = subscribeScrollMemory(onChange);
  if (typeof window === "undefined") return unsub;
  const onStorage = (e: StorageEvent) => {
    if (e.key === MD_SCROLL_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsub();
    window.removeEventListener("storage", onStorage);
  };
}
