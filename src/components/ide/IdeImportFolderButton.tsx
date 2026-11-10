"use client";

import { FolderOpen } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";

/** Android APK: pick a system folder via SAF into the zip sandbox. */
export function IdeImportFolderButton({
  variant = "accent",
  size = "lg",
  className,
  label = "选择文件夹",
  title = "选择系统文件夹，导入到应用沙箱（不写入 content/，也不会写回原文件夹）",
}: {
  variant?: "accent" | "ghost" | "secondary" | "outline" | "default";
  size?: "lg" | "sm" | "md" | "icon";
  className?: string;
  label?: string;
  title?: string;
}) {
  const status = useIdeStore((s) => s.status);
  const importSafFolderProject = useIdeStore((s) => s.importSafFolderProject);
  const busy = status === "正在选择文件夹…" || status === "正在导入文件夹…";

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className ?? "gap-2"}
      disabled={busy}
      title={title}
      aria-label={label}
      onClick={() => void importSafFolderProject()}
    >
      <FolderOpen className="h-4 w-4" />
      {busy ? "导入中…" : label}
    </Button>
  );
}
