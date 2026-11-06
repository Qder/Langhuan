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
  | "exportActive"
  | "findReplace"
  | "search"
  | "previewUndo"
  | "previewRedo"
  | "toggleToc"
  | "typewriterMode";

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
  findReplace: "mod+shift+h",
  search: "mod+f",
  previewUndo: "mod+z",
  previewRedo: "mod+shift+z",
  toggleToc: "mod+shift+o",
  typewriterMode: "mod+shift+t",
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
  findReplace: "查找替换",
  search: "文件内查找",
  previewUndo: "撤销预览编辑",
  previewRedo: "重做预览编辑",
  toggleToc: "打开 / 关闭目录",
  typewriterMode: "打字机滚动",
};

export function normalizeShortcuts(
  partial?: Partial<ShortcutMap> | null
): ShortcutMap {
  return { ...DEFAULT_SHORTCUTS, ...(partial || {}) };
}

/**
 * 焦点在「会吃掉字符」的输入区吗？
 *
 * 注意 `isContentEditable`：CodeMirror 的 `.cm-content` 与混合模式的块
 * 都是 contenteditable，所以光判 INPUT/TEXTAREA 会漏掉它们。
 * 漏掉的后果是「正在写作时按不出任何快捷键」，而写作恰恰最需要些快捷键。
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

/**
 * 允许在输入区里生效的快捷键。
 *
 * 准入标准是「不产生字符、也不和输入法组合键抢键」：
 * 这类动作必须在写作中可用，否则用户得先点别处、按一次、再点回来。
 */
export const SHORTCUTS_ALLOWED_WHILE_TYPING: ReadonlySet<ShortcutAction> =
  new Set<ShortcutAction>(["typewriterMode"]);

/** 把「输入中要不要放行」这一条收敛到一处，避免每个分支各写一遍守卫。 */
export function shortcutAllowedWhileTyping(
  action: ShortcutAction,
  typing: boolean
): boolean {
  return !typing || SHORTCUTS_ALLOWED_WHILE_TYPING.has(action);
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

/**
 * Claim an in-app shortcut so the browser (find bar, save page, etc.) does not
 * also handle it. Call after deciding to handle the key.
 */
export function claimShortcut(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  // Stop other window/document listeners in the same phase from double-handling.
  if (typeof e.stopImmediatePropagation === "function") {
    e.stopImmediatePropagation();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
