"use client";

import * as React from "react";
import {
  readScrollMemory,
  scrollTargetFor,
  writeScrollMemory,
} from "./scrollMemory";
import { READER_SCROLL_ID } from "./useReadingProgress";

/** 连续若干帧：图片 / mermaid / KaTeX 常在首帧之后才把正文撑高。 */
const RESTORE_PASSES = 3;
/** 从读码切回时布局可能尚未撑开，高度为 0 时按这个节奏再试，不把 0 当结论。 */
const RESTORE_RETRY_MS = [200, 500, 1200] as const;

export type ReaderScrollMemoryOptions = {
  /** 文档身份（content 相对路径）。空串 = 不记也不恢复。 */
  path: string;
  /** 仅阅读预览。split / source / mixed 各有自己的坐标系，一律不碰。 */
  enabled: boolean;
  /**
   * 有别的跳转要做（例如「定位到源码」）时传 true：这一轮让位，
   * 并把该篇记成已处理，免得跳转清空后恢复又追上来。
   */
  yieldTo?: boolean;
};

type Tracked = { path: string; top: number; max: number };

/**
 * 把 Markdown 阅读预览的滚动位置存到 localStorage，再次打开同篇时还原。
 *
 * 存的是 scrollTop **与 ratio 一起**：正文高度会随图片/公式变化，按比例还原比
 * 记死像素可靠。换篇时保存的是滚动那一刻跟踪下来的值，而不是卸载时的 DOM 读数
 * —— cleanup 跑在下一篇文章提交之后，读 DOM 会把上一篇的进度写到下一篇头上。
 */
export function useReaderScrollMemory({
  path,
  enabled,
  yieldTo = false,
}: ReaderScrollMemoryOptions): void {
  /** 已为哪篇恢复过：同一次进入文档只恢复一次。 */
  const restoredForRef = React.useRef<string | null>(null);
  /** 恢复写进去的 scroll 事件不能立刻再存回一遍。 */
  const suppressSaveRef = React.useRef(false);
  const trackedRef = React.useRef<Tracked | null>(null);
  /** 上一轮真正处理过的文档；`null` = 还没有过。 */
  const prevPathRef = React.useRef<string | null>(null);
  /** 上一轮 effect 是否处于 enabled：用来区分「切回预览」和「yieldTo 变化」。 */
  const prevEnabledRef = React.useRef(false);

  // 先「归零 + 恢复」，再挂保存监听：`#reader-scroll` 是共享节点，换篇时浏览器会
  // 把旧 scrollTop clamp 到新正文的最大值（更短的文档就停在底部）。若保存监听
  // 先挂上，那个 clamp 值会被当成新一篇的阅读位置写进去。
  React.useEffect(() => {
    if (!enabled || !path) {
      prevEnabledRef.current = false;
      return;
    }
    const prevPath = prevPathRef.current;
    const enabledAgain = !prevEnabledRef.current;
    const samePath = prevPath === path;
    prevPathRef.current = path;
    prevEnabledRef.current = true;
    // 同一篇且一直开着（例如从「定位到源码」回来）不再重来一遍。
    // 预览被关掉再打开（切源码 / 切到读码再回来）要再试一次：隐藏或卸载
    // 后 scrollTop 在部分 WebView 上会丢。
    if (samePath && !enabledAgain) return;

    const pathChanged = !samePath;
    if (pathChanged) restoredForRef.current = null;

    const root = document.getElementById(READER_SCROLL_ID);
    if (!root) return;
    let zeroTimer = 0;
    // 换篇才清残留坐标。同一篇重新打开时保留当前 scrollTop，若已被重置为 0，
    // 后面的恢复会补上。
    if (pathChanged) {
      if (root.scrollTop !== 0) {
        suppressSaveRef.current = true;
        root.scrollTop = 0;
        zeroTimer = window.setTimeout(() => {
          suppressSaveRef.current = false;
        }, 120);
      }
      trackedRef.current = {
        path,
        top: 0,
        max: root.scrollHeight - root.clientHeight,
      };
    }

    if (yieldTo) {
      restoredForRef.current = path;
      return () => {
        if (zeroTimer) window.clearTimeout(zeroTimer);
      };
    }
    const entry = readScrollMemory(path);
    // 没有记录（或记录已坏）：停在顶部，不要继承上一篇的坐标。
    if (!entry || entry.ratio <= 0) {
      restoredForRef.current = path;
      return () => {
        if (zeroTimer) window.clearTimeout(zeroTimer);
      };
    }
    restoredForRef.current = path;

    const rafs: number[] = [];
    const retryTimers: number[] = [];
    let suppressTimer = 0;
    /** 用户在恢复期间自己滚了 → 后续补帧不能把他拽回去。 */
    let settled = false;
    const onUserScroll = () => {
      if (!suppressSaveRef.current) settled = true;
    };
    root.addEventListener("scroll", onUserScroll, { passive: true });

    const apply = () => {
      if (settled) return;
      // 面板尚未撑开时 clientHeight 为 0，max 会虚高，绝不能按这个数落点。
      if (root.clientHeight <= 0) return;
      const target = scrollTargetFor(entry, root.scrollHeight, root.clientHeight);
      // 还没渲染出可滚高度：留给后续帧 / ResizeObserver / 延迟重试，别把 0 当结论。
      if (target == null) return;
      // 同一篇重新打开且位置已经在目标附近：不要闪一下再写回去。
      if (samePath && Math.abs(root.scrollTop - target) <= 2) {
        trackedRef.current = {
          path,
          top: root.scrollTop,
          max: root.scrollHeight - root.clientHeight,
        };
        return;
      }
      suppressSaveRef.current = true;
      root.scrollTop = target;
      trackedRef.current = {
        path,
        top: root.scrollTop,
        max: root.scrollHeight - root.clientHeight,
      };
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressSaveRef.current = false;
      }, 120);
    };

    apply();
    const schedule = (remaining: number) => {
      if (remaining <= 0) return;
      rafs.push(
        requestAnimationFrame(() => {
          apply();
          schedule(remaining - 1);
        })
      );
    };
    schedule(RESTORE_PASSES);
    for (const ms of RESTORE_RETRY_MS) {
      retryTimers.push(window.setTimeout(apply, ms));
    }
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => apply());
      ro.observe(root);
    }

    return () => {
      root.removeEventListener("scroll", onUserScroll);
      rafs.forEach((id) => cancelAnimationFrame(id));
      retryTimers.forEach((id) => window.clearTimeout(id));
      if (zeroTimer) window.clearTimeout(zeroTimer);
      window.clearTimeout(suppressTimer);
      ro?.disconnect();
      suppressSaveRef.current = false;
    };
  }, [path, enabled, yieldTo]);

  React.useEffect(() => {
    if (!enabled || !path) return;
    const root = document.getElementById(READER_SCROLL_ID);
    if (!root) return;

    const measure = (): Tracked => ({
      path,
      top: root.scrollTop,
      max: root.scrollHeight - root.clientHeight,
    });
    // 面板被隐藏时 clientHeight 为 0，max 会虚高，这一帧测量不可信。
    const measurable = () => root.isConnected && root.clientHeight > 0;
    /** 换篇/恢复写出来的 scroll 不算用户读数，别拿它给别人记位置。 */
    let sawCredibleScroll = false;

    let raf = 0;
    const flush = () => {
      raf = 0;
      if (suppressSaveRef.current) return;
      if (!sawCredibleScroll) return;
      const last = trackedRef.current;
      if (!last || last.path !== path) return;
      writeScrollMemory(last.path, last.top, last.max);
    };
    const onScroll = () => {
      if (measurable()) {
        trackedRef.current = measure();
        if (!suppressSaveRef.current) sawCredibleScroll = true;
      }
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };
    // 关标签 / 退应用时 rAF 可能来不及跑，补最后一把。
    const onHide = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      flush();
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      if (raf) cancelAnimationFrame(raf);
      // 换文档 / 切模式 / 卸载前再存一次（用跟踪值，不读 DOM）。
      flush();
    };
  }, [path, enabled]);
}
