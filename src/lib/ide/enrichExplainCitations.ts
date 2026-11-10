/**
 * Attach project id + a source snapshot to explain citations when we still
 * have the selection or an open file body.
 */
import { normalizeIdeRelPath } from "./citations";
import type { ExplainCitation } from "./captureNote";

export type CitationSnapshotContext = {
  projectId?: string | null;
  selection?: {
    path: string;
    text?: string;
    fromLine: number;
    toLine: number;
  } | null;
  files?: Array<{ path: string; content: string }>;
};

function sliceLines(content: string, fromLine: number, toLine: number): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const from = Math.max(1, Math.floor(fromLine));
  const to = Math.max(from, Math.floor(toLine));
  return lines.slice(from - 1, to).join("\n");
}

export function enrichExplainCitations(
  cites: ExplainCitation[] | undefined,
  ctx: CitationSnapshotContext
): ExplainCitation[] {
  const projectId = (ctx.projectId || "").trim();
  const files = (ctx.files ?? []).map((f) => ({
    path: normalizeIdeRelPath(f.path),
    content: f.content,
  }));
  const selPath = ctx.selection
    ? normalizeIdeRelPath(ctx.selection.path)
    : "";
  const selText =
    ctx.selection?.text && ctx.selection.text.trim()
      ? ctx.selection.text
      : "";

  return (cites ?? []).map((c) => {
    const path = normalizeIdeRelPath(c.path);
    const next: ExplainCitation = {
      ...c,
      path,
      projectId: c.projectId || projectId || undefined,
    };
    if (next.snapshot) return next;
    if (selPath && path === selPath && selText) {
      return {
        ...next,
        snapshot: selText,
        line: next.line ?? ctx.selection!.fromLine,
        endLine: next.endLine ?? ctx.selection!.toLine,
      };
    }
    const from = next.line;
    if (from == null) return next;
    const file = files.find((f) => f.path === path);
    if (!file) return next;
    const snapshot = sliceLines(file.content, from, next.endLine ?? from);
    if (!snapshot.trim()) return next;
    return { ...next, snapshot };
  });
}

/** Primary file citation when the user had a selection but the reply cited nothing. */
export function primarySelectionCitation(
  ctx: CitationSnapshotContext & { sourcePath?: string | null }
): ExplainCitation | null {
  const path = normalizeIdeRelPath(ctx.selection?.path || ctx.sourcePath || "");
  const text =
    ctx.selection?.text && ctx.selection.text.trim()
      ? ctx.selection.text
      : "";
  if (!path || !text || ctx.selection == null) return null;
  return {
    path,
    line: ctx.selection.fromLine,
    endLine: ctx.selection.toLine,
    snapshot: text,
    projectId: ctx.projectId || undefined,
  };
}
