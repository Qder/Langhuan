"use client";

import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import { useStore } from "@/lib/store";

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function IdeDirtyCloseDialog() {
  const pending = useIdeStore((s) => s.pendingClose);
  const resolvePendingClose = useIdeStore((s) => s.resolvePendingClose);
  const open = !!pending;
  const setAppMode = useStore((s) => s.setAppMode);

  const onResolve = async (choice: "save" | "discard" | "cancel") => {
    const after = useIdeStore.getState().pendingClose?.after;
    await resolvePendingClose(choice);
    if (choice === "cancel") return;
    // After draining dirty tabs for switchNotes
    if (after === "switchNotes") {
      const st = useIdeStore.getState();
      if (st.anyDirty()) {
        const dirty = st.tabs.find((t) => st.isDirty(t.path));
        if (dirty) {
          useIdeStore.setState({
            pendingClose: { path: dirty.path, after: "switchNotes" },
          });
          return;
        }
      }
      setAppMode("notes");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => void onResolve("cancel")}
      labelledBy="ide-dirty-close-title"
    >
      <div className="p-5 space-y-3">
        <h2 id="ide-dirty-close-title" className="font-serif text-lg font-semibold">
          有未保存的修改
        </h2>
        <p className="text-sm text-[var(--muted)]">
          「{pending ? basename(pending.path) : "当前文件"}」尚未保存。关闭前要怎么处理？
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => void onResolve("cancel")}>
            继续编辑
          </Button>
          <Button variant="ghost" onClick={() => void onResolve("discard")}>
            放弃修改
          </Button>
          <Button variant="accent" onClick={() => void onResolve("save")}>
            保存并关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
