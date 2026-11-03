/**
 * IDE explain panel toggle: ⌘/Ctrl+Shift+L (not bare Mod+L — leave browser address bar alone).
 */

export type HotkeyMods = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
};

/** True when the event should toggle the explain panel. */
export function isIdeExplainToggleHotkey(e: HotkeyMods): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (!e.shiftKey) return false;
  if (e.altKey) return false;
  return e.key.toLowerCase() === "l";
}

/** Bare Mod+L must not be claimed by the IDE (Chrome address bar). */
export function isBareModL(e: HotkeyMods): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.shiftKey || e.altKey) return false;
  return e.key.toLowerCase() === "l";
}

/** Skip explain hotkey when typing in form fields (except Mod+Shift+L chord is still ok to handle at window). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
