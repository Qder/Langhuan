export type DirtyCloseChoice = "save" | "discard" | "cancel";

/** Whether closing a tab / leaving must wait for a dirty-close decision. */
export function shouldBlockDirtyClose(dirty: boolean): boolean {
  return dirty;
}

/**
 * Resolve what happens after the user picks an option.
 * Returns whether the close/nav may proceed.
 */
export function resolveDirtyClose(choice: DirtyCloseChoice): {
  proceed: boolean;
  saveFirst: boolean;
  discard: boolean;
} {
  switch (choice) {
    case "save":
      return { proceed: true, saveFirst: true, discard: false };
    case "discard":
      return { proceed: true, saveFirst: false, discard: true };
    case "cancel":
    default:
      return { proceed: false, saveFirst: false, discard: false };
  }
}
