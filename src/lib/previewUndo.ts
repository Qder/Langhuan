/**
 * In-memory per-document undo/redo for preview inline edits.
 * Not persisted — refresh clears. Does not touch CodeMirror history.
 */

export const PREVIEW_UNDO_LIMIT = 50;

export type PreviewUndoStacks = {
  undo: string[];
  redo: string[];
};

export function emptyPreviewUndoStacks(): PreviewUndoStacks {
  return { undo: [], redo: [] };
}

/** Push content-before-edit; clears redo. Caps undo at PREVIEW_UNDO_LIMIT. */
export function pushPreviewUndoEntry(
  stacks: PreviewUndoStacks,
  beforeContent: string
): PreviewUndoStacks {
  const undo = stacks.undo.concat(beforeContent);
  while (undo.length > PREVIEW_UNDO_LIMIT) undo.shift();
  return { undo, redo: [] };
}

/**
 * Pop undo → restore that content; current goes to redo.
 * Returns null when undo is empty (caller must not clear the body).
 */
export function undoPreviewEntry(
  stacks: PreviewUndoStacks,
  current: string
): { stacks: PreviewUndoStacks; content: string } | null {
  if (stacks.undo.length === 0) return null;
  const undo = stacks.undo.slice();
  const content = undo.pop()!;
  const redo = stacks.redo.concat(current);
  while (redo.length > PREVIEW_UNDO_LIMIT) redo.shift();
  return { stacks: { undo, redo }, content };
}

/**
 * Pop redo → restore that content; current goes to undo.
 * Returns null when redo is empty.
 */
export function redoPreviewEntry(
  stacks: PreviewUndoStacks,
  current: string
): { stacks: PreviewUndoStacks; content: string } | null {
  if (stacks.redo.length === 0) return null;
  const redo = stacks.redo.slice();
  const content = redo.pop()!;
  const undo = stacks.undo.concat(current);
  while (undo.length > PREVIEW_UNDO_LIMIT) undo.shift();
  return { stacks: { undo, redo }, content };
}

export function clearPreviewUndoStacks(): PreviewUndoStacks {
  return emptyPreviewUndoStacks();
}

/**
 * When focus is inside CodeMirror, document-level undo must not intercept —
 * CM owns Ctrl/Cmd+Z there.
 */
export function isFocusInCodeMirror(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }
  try {
    return !!(target as Element).closest(".cm-editor");
  } catch {
    return false;
  }
}

/** True when AppShell should run preview undo/redo (not CM, not typing fields). */
export function shouldHandlePreviewUndoShortcut(
  target: EventTarget | null,
  typing: boolean
): boolean {
  if (typing) return false;
  if (isFocusInCodeMirror(target)) return false;
  return true;
}
