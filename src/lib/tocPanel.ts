"use client";

import * as React from "react";
import { useStore } from "@/lib/store";

/**
 * 目录浮层的唯一真相 + 开关总线。
 *
 * 这份状态以前是两份 `useState`（TopBar 的 `usePopover()` 一份、专注浮动条
 * 一份），快捷键只能靠 `document.querySelector("[data-toc-popover]")` 反推
 * 「目录开着吗」，两套状态一旦不同步就打架。现在 open/docId 存在这里，两个
 * 宿主都通过 `useTocPanel()` 读写同一份状态。
 *
 * 宿主仍然各自负责渲染（TopBar 锚在顶栏下、专注条锚在浮动条下），但「开没
 * 开」只有一个答案；同一时刻只会挂载其中一个宿主（专注会卸载 TopBar）。
 */
export type TocPanelState = {
  open: boolean;
  /** 打开时所属文档；换文档视为过期。 */
  docId: string | null;
};

let state: TocPanelState = { open: false, docId: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getTocPanelState(): TocPanelState {
  return state;
}

/** Esc 分层用：比 DOM 探测可靠，也不受渲染时机影响。 */
export function isTocPanelOpen(): boolean {
  return state.open;
}

export function setTocPanelOpen(
  open: boolean,
  docId: string | null = state.docId
): void {
  const next: TocPanelState = { open, docId: open ? docId : null };
  if (next.open === state.open && next.docId === state.docId) return;
  state = next;
  emit();
}

export function closeTocPanel(): void {
  setTocPanelOpen(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const TOGGLE_EVENT = "langhuan:toggle-toc";

/** AppShell 的快捷键入口：交给当前挂载的宿主做可用性判断后翻转。 */
export function requestToggleToc(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { cancelable: true }));
}

/**
 * 宿主订阅切换请求，返回退订函数。
 *
 * 一次请求只由一个宿主消费：处理者（无论翻转还是给了「没有大纲」提示）
 * 都会 `preventDefault()`，后面订阅的宿主看到已处理就跳过。正常情况两个
 * 宿主不同时挂载，这条只是保证意外并存时不会一开一关互相抵消。
 */
export function onToggleTocRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    handler();
  };
  window.addEventListener(TOGGLE_EVENT, listener);
  return () => window.removeEventListener(TOGGLE_EVENT, listener);
}

export const TOC_NO_OUTLINE_MESSAGE = "这篇还没有大纲，加几个标题就能跳转";

/**
 * 目录面板的开关行为，TopBar 与专注浮动条共用：
 * 共享 open 状态、点外部/Esc 收起、换文档收起、没有大纲时给一句提示。
 */
export function useTocPanel({
  docId,
  available,
}: {
  docId?: string;
  available: boolean;
}): {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
} {
  const setStatus = useStore((s) => s.setStatus);
  const open = React.useSyncExternalStore(subscribe, isTocPanelOpen, () => false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => setTocPanelOpen(false), []);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!next) {
        setTocPanelOpen(false);
        return;
      }
      if (!available) {
        setStatus(TOC_NO_OUTLINE_MESSAGE);
        return;
      }
      setTocPanelOpen(true, docId ?? null);
    },
    [available, docId, setStatus]
  );

  const toggle = React.useCallback(() => {
    if (isTocPanelOpen()) {
      setTocPanelOpen(false);
      return;
    }
    setOpen(true);
  }, [setOpen]);

  // Same dismissal contract as the TopBar popovers: outside click or Esc.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setTocPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTocPanelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // mod+shift+o：宿主自己判断有没有大纲，再翻转共享状态。
  React.useEffect(() => onToggleTocRequest(toggle), [toggle]);

  // A doc switch leaves a stale panel over the wrong document.
  React.useEffect(() => {
    setTocPanelOpen(false);
  }, [docId]);

  return { open, setOpen, toggle, close, buttonRef, panelRef };
}
