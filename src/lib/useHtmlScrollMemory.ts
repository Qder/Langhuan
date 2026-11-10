"use client";

import * as React from "react";
import { writeScrollMemoryPercent } from "./scrollMemory";
import {
  HTML_SCROLL_RESTORE_RETRY_MS,
  restorePercentForPath,
} from "./htmlScrollMemory";

export type HtmlScrollMemoryOptions = {
  /** 文档身份（content 相对路径）。空串 = 不记也不恢复。 */
  path: string;
  /** 仅阅读预览。split / source 有同步滚动坐标系，一律不碰。 */
  enabled: boolean;
  /**
   * 有别的跳转要做（「定位到源码」、测验跳题）时传 true：这一轮让位，
   * 并把该次载入记成已处理，免得跳转清空后恢复又追上来。
   */
  yieldTo?: boolean;
  /** iframe 重载（换篇 / 改正文 / 手动刷新）时变化，重新等 lh-ready。 */
  reloadKey?: string | number;
  post: (msg: { type: "scrollToPercent"; percent: number }) => void;
  /** 立刻把进度条拨到记忆位置，不必等 iframe 回报。 */
  setPercent?: (n: number) => void;
  /** 恢复期间挡住 preview→editor 同步，避免把编辑器拽走。 */
  onSuppressSync?: (ms: number) => void;
};

/**
 * 把 HTML 预览的阅读百分比存到与 Markdown 共用的 scrollMemory，再次打开同篇时还原。
 *
 * iframe 无 allow-same-origin，只能靠 bridge 的 `lh-scroll` 百分比写入，
 * 并用 `scrollToPercent` 恢复。载入时 bridge 会先报 0，这一轮在恢复结束前不写回，
 * 以免把真实进度覆盖掉。
 */
export function useHtmlScrollMemory({
  path,
  enabled,
  yieldTo = false,
  reloadKey = "",
  post,
  setPercent,
  onSuppressSync,
}: HtmlScrollMemoryOptions): {
  onBridgePercent: (percent: number) => void;
  onIframeReady: (opts?: { yieldTo?: boolean }) => void;
} {
  const readyRef = React.useRef(false);
  const [readyTick, setReadyTick] = React.useState(0);
  const yieldedLoadRef = React.useRef(false);
  const restoreHandledRef = React.useRef(false);
  const suppressSaveRef = React.useRef(false);
  const settledRef = React.useRef(false);
  const targetRef = React.useRef<number | null>(null);
  const lastPercentRef = React.useRef<number | null>(null);
  const sawCredibleRef = React.useRef(false);
  const prevPathRef = React.useRef<string | null>(null);
  const prevEnabledRef = React.useRef(false);
  const prevReloadRef = React.useRef(reloadKey);
  const postRef = React.useRef(post);
  const setPercentRef = React.useRef(setPercent);
  const suppressSyncRef = React.useRef(onSuppressSync);
  const pathRef = React.useRef(path);
  const enabledRef = React.useRef(enabled);
  React.useEffect(() => {
    postRef.current = post;
    setPercentRef.current = setPercent;
    suppressSyncRef.current = onSuppressSync;
    pathRef.current = path;
    enabledRef.current = enabled;
  });

  const resetLoad = React.useCallback(() => {
    readyRef.current = false;
    yieldedLoadRef.current = false;
    restoreHandledRef.current = false;
    settledRef.current = false;
    targetRef.current = null;
    lastPercentRef.current = null;
    sawCredibleRef.current = false;
    suppressSaveRef.current = false;
  }, []);

  React.useEffect(() => {
    if (prevPathRef.current === path && prevReloadRef.current === reloadKey) {
      return;
    }
    resetLoad();
    prevPathRef.current = path;
    prevReloadRef.current = reloadKey;
  }, [path, reloadKey, resetLoad]);

  // 打开一篇时先把进度条拨到记忆位置，避免先闪 0。
  React.useEffect(() => {
    if (!enabled || !path) return;
    const saved = restorePercentForPath(path);
    if (saved != null) setPercentRef.current?.(saved);
  }, [path, enabled, reloadKey]);

  const onBridgePercent = React.useCallback((percent: number) => {
    if (!Number.isFinite(percent)) return;
    const clamped = Math.min(100, Math.max(0, percent));
    lastPercentRef.current = clamped;
    if (suppressSaveRef.current) return;
    if (!enabledRef.current || !pathRef.current) return;
    if (!restoreHandledRef.current) return;
    const target = targetRef.current;
    if (target != null && !settledRef.current) {
      if (Math.abs(clamped - target) > 2) {
        settledRef.current = true;
        sawCredibleRef.current = true;
        writeScrollMemoryPercent(pathRef.current, clamped);
      }
      return;
    }
    sawCredibleRef.current = true;
    writeScrollMemoryPercent(pathRef.current, clamped);
  }, []);

  const onIframeReady = React.useCallback((opts?: { yieldTo?: boolean }) => {
    if (opts?.yieldTo) yieldedLoadRef.current = true;
    readyRef.current = true;
    setReadyTick((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!enabled || !path) {
      prevEnabledRef.current = false;
      return;
    }
    if (!readyRef.current) {
      prevEnabledRef.current = true;
      return;
    }
    const prevPath = prevPathRef.current;
    const enabledAgain = !prevEnabledRef.current;
    const samePath = prevPath === path;
    const sameReload = prevReloadRef.current === reloadKey;
    prevPathRef.current = path;
    prevReloadRef.current = reloadKey;
    prevEnabledRef.current = true;

    if (samePath && sameReload && !enabledAgain && restoreHandledRef.current) {
      return;
    }

    restoreHandledRef.current = true;
    settledRef.current = false;
    if (yieldTo || yieldedLoadRef.current) {
      yieldedLoadRef.current = true;
      targetRef.current = null;
      return;
    }

    const target = restorePercentForPath(path);
    if (target == null) {
      targetRef.current = null;
      return;
    }
    targetRef.current = target;
    setPercentRef.current?.(target);

    const retryTimers: number[] = [];
    let suppressTimer = 0;
    const apply = () => {
      if (settledRef.current) return;
      suppressSaveRef.current = true;
      postRef.current({ type: "scrollToPercent", percent: target });
      suppressSyncRef.current?.(400);
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressSaveRef.current = false;
      }, 120);
    };

    apply();
    for (const ms of HTML_SCROLL_RESTORE_RETRY_MS) {
      retryTimers.push(window.setTimeout(apply, ms));
    }

    return () => {
      retryTimers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(suppressTimer);
      suppressSaveRef.current = false;
    };
  }, [path, enabled, yieldTo, readyTick, reloadKey]);

  React.useEffect(() => {
    if (!enabled || !path) return;
    const onHide = () => {
      if (!sawCredibleRef.current) return;
      const last = lastPercentRef.current;
      if (last == null) return;
      writeScrollMemoryPercent(path, last);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [path, enabled]);

  return { onBridgePercent, onIframeReady };
}
