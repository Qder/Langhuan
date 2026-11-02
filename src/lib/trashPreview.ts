import type { Document, TrashItem } from "./types";

export const TRASH_PREVIEW_MAX_LINES = 40;

export type TrashPreviewBody =
  | { kind: "empty"; message: "无正文可预览" }
  | {
      kind: "md" | "html";
      /** Truncated source (≤ maxLines), never executed */
      text: string;
      truncated: boolean;
      lineCount: number;
    };

/** Truncate document body for trash preview (≤ maxLines, keep the start). */
export function trashPreviewBody(
  content: string | undefined | null,
  type: Document["type"],
  maxLines = TRASH_PREVIEW_MAX_LINES
): TrashPreviewBody {
  const raw = typeof content === "string" ? content : "";
  if (!raw.trim()) {
    return { kind: "empty", message: "无正文可预览" };
  }
  const lines = raw.split("\n");
  const truncated = lines.length > maxLines;
  const kept = truncated ? lines.slice(0, maxLines) : lines;
  const text = truncated ? kept.join("\n") + "\n…" : kept.join("\n");
  return {
    kind: type === "html" ? "html" : "md",
    text,
    truncated,
    lineCount: kept.length,
  };
}

export function trashPreviewMeta(item: TrashItem): {
  title: string;
  path: string;
  deletedAt: number;
} {
  const path = item.doc.path;
  const base = path.split("/").pop() || path;
  const title = base.replace(/\.(md|html)$/i, "") || path;
  return { title, path, deletedAt: item.deletedAt };
}
