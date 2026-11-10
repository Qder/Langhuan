"use client";
import * as React from "react";
import { Dialog } from "./ui/dialog";
import { markReleaseNotesSeen, readCurrentBuild, releaseNotesFor, shouldShowReleaseNotes, type AppBuild } from "@/lib/releaseNotes";

export function ReleaseNotes({ startup = false }: { startup?: boolean }) {
  const [build, setBuild] = React.useState<AppBuild | null>(null);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const id = React.useId();
  React.useEffect(() => {
    let alive = true;
    void readCurrentBuild().then((current) => {
      if (!alive) return;
      setBuild(current);
      if (startup && shouldShowReleaseNotes(current)) setOpen(true);
    }).catch(() => { if (alive) setError("无法读取实际应用版本"); });
    return () => { alive = false; };
  }, [startup]);
  const close = () => { if (build) markReleaseNotesSeen(build); setOpen(false); };
  return <>
    {!startup && <button type="button" className="min-h-10 text-xs text-[var(--muted)]" onClick={() => setOpen(true)}>
      {build ? `当前版本 ${build.label} · 更新说明` : error || "读取版本…"}
    </button>}
    <Dialog open={open} onClose={close} labelledBy={id}>
      <div className="p-4 space-y-3">
        <h2 id={id}>更新说明 · {build?.label || error}</h2>
        <p className="text-sm whitespace-pre-wrap">{build ? releaseNotesFor(build) : "实际应用版本读取失败，未匹配远程更新说明。"}</p>
        <button type="button" className="min-h-10" onClick={close}>知道了</button>
      </div>
    </Dialog>
  </>;
}
