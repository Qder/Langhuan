"use client";

import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import { basename } from "@/lib/utils";

export function DirtyNavDialog() {
  const pendingNav = useStore((s) => s.pendingNav);
  const resolvePendingNav = useStore((s) => s.resolvePendingNav);
  const active = useStore((s) => s.getActive());
  const open = !!pendingNav;

  return (
    <Dialog open={open} onClose={() => resolvePendingNav("cancel")} labelledBy="dirty-nav-title">
      <div className="p-5 space-y-3">
        <h2 id="dirty-nav-title" className="font-serif text-lg font-semibold">
          有未保存的修改
        </h2>
        <p className="text-sm text-[var(--muted)]">
          「{active ? basename(active.path) : "当前文档"}」尚未保存。离开前要怎么处理？
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => resolvePendingNav("cancel")}>
            继续编辑
          </Button>
          <Button variant="ghost" onClick={() => resolvePendingNav("discard")}>
            放弃修改
          </Button>
          <Button variant="accent" onClick={() => resolvePendingNav("save")}>
            保存并离开
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
