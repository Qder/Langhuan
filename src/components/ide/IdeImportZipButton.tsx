"use client";

import * as React from "react";
import { FileArchive } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";

/** Stable id so menus / multiple buttons share one file input. */
export const IDE_IMPORT_ZIP_INPUT_ID = "langhuan-ide-import-zip";

export function triggerIdeImportZipPicker(): void {
  if (typeof document === "undefined") return;
  document.getElementById(IDE_IMPORT_ZIP_INPUT_ID)?.click();
}

/** Mount once (e.g. in IdeTopBar). Owns the hidden file input. */
export function IdeImportZipHost() {
  const importZipProject = useIdeStore((s) => s.importZipProject);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importZipProject(file, file.name);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <input
      id={IDE_IMPORT_ZIP_INPUT_ID}
      ref={inputRef}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      className="sr-only"
      aria-hidden
      tabIndex={-1}
      onChange={(e) => void onPick(e.target.files?.[0])}
    />
  );
}

/**
 * Button that opens the shared zip picker (IdeImportZipHost must be mounted).
 * Android WebView can pick a single .zip even when directory pickers NPE.
 */
export function IdeImportZipButton({
  variant = "accent",
  size = "lg",
  className,
  label = "导入工程 zip",
  title = "把工程打成 zip 后导入应用沙箱（不写入 content/）",
}: {
  variant?: "accent" | "ghost" | "secondary" | "outline" | "default";
  size?: "lg" | "sm" | "md" | "icon";
  className?: string;
  label?: string;
  title?: string;
}) {
  const status = useIdeStore((s) => s.status);
  const busy = status === "正在导入 zip…";

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className ?? "gap-2"}
      disabled={busy}
      title={title}
      aria-label={label}
      onClick={() => triggerIdeImportZipPicker()}
    >
      <FileArchive className="h-4 w-4" />
      {busy ? "导入中…" : label}
    </Button>
  );
}
