"use client";

import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { BUILTIN_TEMPLATES } from "@/lib/templates";

export function TemplateDialog() {
  const open = useStore((s) => s.templateDialogOpen);
  const setOpen = useStore((s) => s.setTemplateDialogOpen);
  const createFromTemplate = useStore((s) => s.createFromTemplate);
  const openDailyNote = useStore((s) => s.openDailyNote);
  const [title, setTitle] = React.useState("");
  const [picked, setPicked] = React.useState("meeting");

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="tpl-title">
      <div className="p-5 space-y-3">
        <h2 id="tpl-title" className="font-serif text-lg font-semibold">
          模板与每日笔记
        </h2>
        <Button
          variant="accent"
          className="w-full"
          onClick={() => {
            openDailyNote();
            setOpen(false);
          }}
        >
          打开今日笔记
        </Button>
        <div className="text-xs text-[var(--muted)]">或从模板新建</div>
        <div className="grid gap-1.5">
          {BUILTIN_TEMPLATES.filter((t) => t.id !== "daily").map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPicked(t.id)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                picked === t.id
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              {t.name}
              <span className="block text-[11px] text-[var(--muted)] font-mono mt-0.5">
                {t.pathPattern}
              </span>
            </button>
          ))}
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可选）"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="accent"
            onClick={() => {
              createFromTemplate(picked, title.trim() || undefined);
              setOpen(false);
              setTitle("");
            }}
          >
            用模板创建
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
