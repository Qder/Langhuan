/** Customizable keyboard shortcuts for 琅嬛. */

export type ShortcutAction =
  | "commandPalette"
  | "save"
  | "toggleSource"
  | "newMd"
  | "dailyNote"
  | "focusMode"
  | "toggleDocSplit"
  | "closeTab"
  | "exportActive";

export type ShortcutMap = Record<ShortcutAction, string>;

/** Binding strings: "mod+k", "mod+shift+e", "f", "escape". `mod` = ⌘ on Mac / Ctrl elsewhere. */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  commandPalette: "mod+k",
  save: "mod+s",
  toggleSource: "mod+e",
  newMd: "mod+n",
  dailyNote: "mod+d",
  focusMode: "f",
  toggleDocSplit: "mod+\\",
  closeTab: "mod+w",
  exportActive: "mod+shift+e",
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  commandPalette: "命令面板",
  save: "保存文档",
  toggleSource: "预览 ↔ 源码",
  newMd: "新建 Markdown",
  dailyNote: "今日笔记",
  focusMode: "专注 / 沉浸",
  toggleDocSplit: "文档分屏",
  closeTab: "关闭当前标签",
  exportActive: "导出当前文档",
};

export function normalizeShortcuts(
  partial?: Partial<ShortcutMap> | null
): ShortcutMap {
  return { ...DEFAULT_SHORTCUTS, ...(partial || {}) };
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function formatShortcut(binding: string): string {
  const mac = isMac();
  return binding
    .split("+")
    .map((p) => {
      const k = p.trim().toLowerCase();
      if (k === "mod") return mac ? "⌘" : "Ctrl";
      if (k === "ctrl") return mac ? "⌃" : "Ctrl";
      if (k === "alt" || k === "option") return mac ? "⌥" : "Alt";
      if (k === "shift") return mac ? "⇧" : "Shift";
      if (k === "escape" || k === "esc") return "Esc";
      if (k === "\\") return "\\";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(mac ? "" : "+");
}

export function matchShortcut(e: KeyboardEvent, binding: string): boolean {
  const parts = binding
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return false;

  let wantMod = false;
  let wantCtrl = false;
  let wantAlt = false;
  let wantShift = false;
  let key = "";

  for (const p of parts) {
    if (p === "mod") wantMod = true;
    else if (p === "ctrl" || p === "control") wantCtrl = true;
    else if (p === "alt" || p === "option") wantAlt = true;
    else if (p === "shift") wantShift = true;
    else key = p;
  }

  const meta = e.metaKey || e.ctrlKey;
  if (wantMod) {
    if (!meta) return false;
  } else if (wantCtrl) {
    if (!e.ctrlKey) return false;
  } else if (e.metaKey || e.ctrlKey) {
    // bare key bindings should not fire with mod held (except focusMode etc.)
    // Allow if only shift/alt intended — handled below
    if (!wantAlt && !wantShift) return false;
    if (meta && !wantMod && !wantCtrl) return false;
  }

  if (wantAlt !== e.altKey) return false;
  if (wantShift !== e.shiftKey) return false;

  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (key === "escape" || key === "esc") return pressed === "escape";
  if (key === "\\") return e.key === "\\" || e.code === "Backslash";
  return pressed === key;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
