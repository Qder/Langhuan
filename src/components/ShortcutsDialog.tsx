"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  formatShortcut,
  normalizeShortcuts,
  type ShortcutAction,
  type ShortcutMap,
} from "@/lib/shortcuts";

const ACTIONS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[];

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsDialogOpen);
  const setOpen = useStore((s) => s.setShortcutsDialogOpen);
  const custom = useStore((s) => s.customShortcuts);
  const setCustomShortcuts = useStore((s) => s.setCustomShortcuts);
  const resetCustomShortcuts = useStore((s) => s.resetCustomShortcuts);
  const merged = normalizeShortcuts(custom);
  const [draft, setDraft] = React.useState<ShortcutMap>(merged);

  React.useEffect(() => {
    if (open) setDraft(normalizeShortcuts(useStore.getState().customShortcuts));
  }, [open]);

  const onSave = () => {
    const patch: Partial<ShortcutMap> = {};
    for (const k of ACTIONS) {
      const v = draft[k]?.trim();
      if (v && v !== DEFAULT_SHORTCUTS[k]) patch[k] = v;
    }
    // Clear then set so removed overrides stick
    resetCustomShortcuts();
    if (Object.keys(patch).length) setCustomShortcuts(patch);
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="sc-title" className="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="sc-title" className="text-lg font-semibold font-ui">
            快捷键
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            使用 <code className="text-xs">mod</code> 表示 ⌘/Ctrl，例如{" "}
            <code className="text-xs">mod+k</code>、<code className="text-xs">mod+shift+e</code>。
          </p>
        </div>
        <div className="max-h-[50vh] overflow-y-auto scroll-thin space-y-2">
          {ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 font-ui">{SHORTCUT_LABELS[action]}</span>
              <Input
                value={draft[action]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [action]: e.target.value.toLowerCase() }))
                }
                className="font-mono text-xs h-8"
                spellCheck={false}
              />
              <kbd className="text-[10px] text-[var(--muted)] w-16 text-right shrink-0">
                {formatShortcut(draft[action] || DEFAULT_SHORTCUTS[action])}
              </kbd>
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ ...DEFAULT_SHORTCUTS });
              resetCustomShortcuts();
            }}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={onSave}>保存</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
