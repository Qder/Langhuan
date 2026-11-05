"use client";

import * as React from "react";
import {
  readScrollMemory,
  scrollTargetFor,
  writeScrollMemory,
} from "./scrollMemory";
import { READER_SCROLL_ID } from "./useReadingProgress";

/** 恢复后等两帧：图片 / mermaid / KaTeX 常在首帧之后才把正文撑高。 */
const RESTORE_PASSES = 3;

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

  // 先「归零 + 恢复」，再挂保存监听：`#reader-scroll` 是共享节点，换篇时浏览器会
  // 把旧 scrollTop clamp 到新正文的最大值（更短的文档就停在底部）。若保存监听
  // 先挂上，那个 clamp 值会被当成新一篇的阅读位置写进去。
  React.useEffect(() => {
    if (!enabled || !path) return;
    const prev = prevPathRef.current;
    prevPathRef.current = path;
    // 同一篇重复跑 effect（比如从「定位到源码」回来）不再重来一遍。
    if (prev === path) return;
    restoredForRef.current = null;
    const root = document.getElementById(READER_SCROLL_ID);
    if (!root) return;
    // 共用节点上残留的 scrollTop 一律归零（可能是上一篇的，也可能是 clamp 过
    // 的）。恢复流程随后会把真正的目标设上去。
    if (root.scrollTop !== 0) {
      suppressSaveRef.current = true;
      root.scrollTop = 0;
      window.setTimeout(() => {
        suppressSaveRef.current = false;
      }, 120);
    }
    trackedRef.current = {
      path,
      top: 0,
      max: root.scrollHeight - root.clientHeight,
    };

    if (yieldTo) {
      restoredForRef.current = path;
      return;
    }
    const entry = readScrollMemory(path);
    // 没有记录（或记录已坏）：停在顶部，不要继承上一篇的坐标。
    if (!entry || entry.ratio <= 0) {
      restoredForRef.current = path;
      return;
    }
    restoredForRef.current = path;

    const rafs: number[] = [];
    let timer = 0;
    /** 用户在恢复期间自己滚了 → 后续补帧不能把他拽回去。 */
    let settled = false;
    const onUserScroll = () => {
      if (!suppressSaveRef.current) settled = true;
    };
    root.addEventListener("scroll", onUserScroll, { passive: true });

    const apply = () => {
      if (settled) return;
      const target = scrollTargetFor(entry, root.scrollHeight, root.clientHeight);
      // 还没渲染出高度：留给下一帧，别把 0 当结论。
      if (target == null) return;
      suppressSaveRef.current = true;
      root.scrollTop = target;
      trackedRef.current = {
        path,
        top: root.scrollTop,
        max: root.scrollHeight - root.clientHeight,
      };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        suppressSaveRef.current = false;
      }, 120);
    };

    apply();
    for (let i = 0; i < RESTORE_PASSES; i++) {
      rafs.push(requestAnimationFrame(apply));
    }
    return () => {
      root.removeEventListener("scroll", onUserScroll);
      rafs.forEach((id) => cancelAnimationFrame(id));
      window.clearTimeout(timer);
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
