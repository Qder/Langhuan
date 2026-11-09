/**
 * Browser orchestration: pick → validate → ingest → insert into the *same* doc
 * that captured the insertion offset (never into a switched-to document).
 */
"use client";

import { useStore } from "../store";
import {
  insertImageMarkdownAt,
  insertImageMarkdownInline,
  pickLibraryImageFile,
  suggestedImageFilename,
  validateLibraryImageFile,
} from "./imageUpload";

export type RunImageUploadResult =
  | { status: "ok" }
  | { status: "cancel" }
  | { status: "error"; message: string };

export async function runLibraryImageUpload(opts: {
  docId: string;
  /** Captured before the file dialog opens. */
  insertAt: number;
  /** block = preview mid-doc; inline = source caret splice. */
  style?: "block" | "inline";
  /** Pre-picked file (skip dialog). */
  file?: File | null;
}): Promise<RunImageUploadResult> {
  const style = opts.style ?? "block";
  const file =
    opts.file === undefined ? await pickLibraryImageFile() : opts.file;
  if (!file) return { status: "cancel" };

  const validation = validateLibraryImageFile(file);
  if (!validation.ok) {
    useStore.getState().setStatus(validation.message);
    return { status: "error", message: validation.message };
  }

  const before = useStore.getState();
  if (!before.documents.some((d) => d.id === opts.docId)) {
    const message = "文档已关闭，取消插入图片";
    before.setStatus(message);
    return { status: "error", message };
  }

  // Normalize empty MIME for Android pickers before ingest.
  const blob =
    file.type && file.type.startsWith("image/")
      ? file
      : new File([file], suggestedImageFilename(file, validation.mime), {
          type: validation.mime,
          lastModified: file.lastModified,
        });

  const res = await before.ingestImageFile(
    opts.docId,
    blob,
    suggestedImageFilename(file, validation.mime)
  );
  if (!res) {
    // ingestImageFile already setStatus on failure paths.
    const msg = useStore.getState().status?.message || "图片入库失败";
    return { status: "error", message: msg };
  }

  const after = useStore.getState();
  if (!after.documents.some((d) => d.id === opts.docId)) {
    const message = "文档已关闭，图片已入库但未写入正文";
    after.setStatus(message);
    return { status: "error", message };
  }

  // Still insert into the captured docId — never activeId (may have switched).
  const cur = after.getContent(opts.docId);
  const at = Math.max(0, Math.min(opts.insertAt, cur.length));
  const next =
    style === "inline"
      ? insertImageMarkdownInline(cur, at, res.snippet)
      : insertImageMarkdownAt(cur, at, res.snippet);

  if (next === cur) {
    const message = "未能写入图片标记";
    after.setStatus(message);
    return { status: "error", message };
  }

  after.pushPreviewUndo(opts.docId, cur);
  after.setDraft(opts.docId, next);
  after.saveDoc(opts.docId);
  after.setStatus(`已插入图片 ${res.asset.path.split("/").pop() || ""}`.trim());
  return { status: "ok" };
}
