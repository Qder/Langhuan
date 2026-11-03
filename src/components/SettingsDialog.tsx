"use client";

import * as React from "react";
import { Keyboard, Settings2 } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  THEME_HINTS,
  THEME_IDS,
  THEME_LABELS,
  THEME_SWATCHES,
  isDarkTheme,
  themeLabel,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const FONT_SIZES = [15, 17, 19, 21] as const;
const LINE_WIDTHS: [number, string][] = [
  [560, "窄"],
  [680, "适中"],
  [740, "默认"],
  [900, "宽"],
];

export function SettingsDialog() {
  const open = useStore((s) => s.settingsDialogOpen);
  const setOpen = useStore((s) => s.setSettingsDialogOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setStatus = useStore((s) => s.setStatus);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const setReadingPrefs = useStore((s) => s.setReadingPrefs);
  const autosaveEnabled = useStore((s) => s.autosaveEnabled);
  const setAutosaveEnabled = useStore((s) => s.setAutosaveEnabled);
  const setShortcutsDialogOpen = useStore((s) => s.setShortcutsDialogOpen);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      labelledBy="settings-title"
      className="max-w-lg"
    >
      <div className="p-5 space-y-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-xl border border-[var(--border)] bg-[var(--hover)] p-2">
            <Settings2 className="h-4 w-4 text-[var(--accent)]" />
          </span>
          <div className="min-w-0">
            <h2 id="settings-title" className="text-lg font-semibold font-ui">
              设置
            </h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              主题、阅读与自动保存。命令与导航仍在 ⌘K。
            </p>
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
            外观 · 当前 {themeLabel(theme)}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[28vh] overflow-y-auto scroll-thin">
            {THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTheme(id);
                  setStatus(`已切换到${THEME_LABELS[id]}`);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  theme === id
                    ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                    : "border-[var(--border)] hover:bg-[var(--hover)]"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3 w-3 shrink-0 rounded-full border border-[var(--border)]",
                    isDarkTheme(id) ? "bg-[#1a1d26]" : "bg-[#faf8f3]"
                  )}
                  style={{ background: THEME_SWATCHES[id] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{THEME_LABELS[id]}</span>
                  <span className="block truncate text-[10px] text-[var(--muted)]">
                    {THEME_HINTS[id]}
                  </span>
                </span>
                {theme === id && (
                  <span className="text-[10px] text-[var(--accent)] shrink-0">当前</span>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
            阅读
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--muted)] w-14 shrink-0">字号</span>
            <div
              className="inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
              role="group"
              aria-label="阅读字号"
            >
              {FONT_SIZES.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setReadingPrefs({ fontSize: sz })}
                  className={cn(
                    "px-2.5 py-1 text-[11px] rounded-[10px] font-ui tabular-nums",
                    readingPrefs.fontSize === sz
                      ? "bg-[var(--accent)] text-white"
                      : "hover:bg-[var(--hover)] text-[var(--muted)]"
                  )}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--muted)] w-14 shrink-0">行宽</span>
            <div
              className="inline-flex rounded-xl border border-[var(--border)] p-0.5 bg-[var(--card)]"
              role="group"
              aria-label="阅读行宽"
            >
              {LINE_WIDTHS.map(([w, label]) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setReadingPrefs({ lineWidth: w })}
                  className={cn(
                    "px-2.5 py-1 text-[11px] rounded-[10px] font-ui",
                    readingPrefs.lineWidth === w
                      ? "bg-[var(--accent)] text-white"
                      : "hover:bg-[var(--hover)] text-[var(--muted)]"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
            编辑
          </h3>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm">
            <span>
              <span className="block font-medium">自动保存</span>
              <span className="block text-xs text-[var(--muted)] mt-0.5">
                2 秒防抖写入当前草稿
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autosaveEnabled}
              onClick={() => setAutosaveEnabled(!autosaveEnabled)}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                autosaveEnabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  autosaveEnabled && "translate-x-5"
                )}
              />
            </button>
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
            快捷键
          </h3>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              setShortcutsDialogOpen(true);
            }}
          >
            <Keyboard className="h-4 w-4" />
            自定义快捷键…
          </Button>
        </section>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
