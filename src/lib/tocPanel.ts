/**
 * 目录浮层的存在探测 + 切换总线。
 *
 * 目录面板的开关状态一直是 `usePopover()` 的组件本地 state（TopBar 一份、
 * 专注浮动条一份），不是全局 store。快捷键要能切换它，又不能为了一个
 * Esc/快捷键把整份 popover 状态搬进 store，所以走一条单向 DOM 事件。
 * TopBar 与专注浮动条同时只会有其中一个挂载，不会抢同一次事件。
 */
export const TOC_PANEL_SELECTOR = "[data-toc-popover]";

const TOGGLE_EVENT = "langhuan:toggle-toc";

/** 专注模式下 Esc 要先问「目录开着吗」：捕获阶段的监听比面板自己的早。 */
export function tocPanelOpenInDom(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(TOC_PANEL_SELECTOR);
}

/** AppShell 的快捷键入口：让当前挂载的目录面板自己翻转。 */
export function requestToggleToc(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
}

/** 面板订阅切换请求，返回退订函数。 */
export function onToggleTocRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(TOGGLE_EVENT, listener);
  return () => window.removeEventListener(TOGGLE_EVENT, listener);
}
