import type { IdeFsEntry } from "./ideFs";

/** Result of collapsing a single-child directory chain (VS Code Compact Folders). */
export type CompactFolderChain = {
  /** Display label, e.g. `java/com/campus/food/campusfood`. */
  label: string;
  /** Folder name segments from the start node through the leaf. */
  segments: string[];
  /** Real project-relative path for each segment (same order as segments). */
  paths: string[];
  /** Deepest directory path — expand/collapse and list children of this. */
  leafPath: string;
  /**
   * Path that still needs `ensureDirListed` to continue/finish the chain.
   * `null` when the chain is complete given the known children map.
   */
  needsList: string | null;
};

function lookup(
  childrenOf: (dirPath: string) => IdeFsEntry[] | undefined,
  path: string
): IdeFsEntry[] | undefined {
  return childrenOf(path);
}

/**
 * Collapse intermediate folders that have exactly one child directory and no
 * sibling files (VS Code Explorer “Compact Folders”).
 *
 * Stops when children are unknown, empty, 2+ kids, or the sole child is a file.
 * `start` must be a directory; files are returned as a trivial one-segment chain.
 */
export function compactFolderChain(
  start: IdeFsEntry,
  childrenOf: (dirPath: string) => IdeFsEntry[] | undefined
): CompactFolderChain {
  if (start.kind !== "directory") {
    return {
      label: start.name,
      segments: [start.name],
      paths: [start.path],
      leafPath: start.path,
      needsList: null,
    };
  }

  const segments = [start.name];
  const paths = [start.path];
  let currentPath = start.path;

  for (;;) {
    const kids = lookup(childrenOf, currentPath);
    if (kids === undefined) {
      return {
        label: segments.join("/"),
        segments,
        paths,
        leafPath: currentPath,
        needsList: currentPath,
      };
    }
    if (kids.length !== 1 || kids[0]!.kind !== "directory") {
      return {
        label: segments.join("/"),
        segments,
        paths,
        leafPath: currentPath,
        needsList: null,
      };
    }
    const only = kids[0]!;
    segments.push(only.name);
    paths.push(only.path);
    currentPath = only.path;
  }
}

/** Convenience: build a children lookup from the IDE store map. */
export function childrenLookupFromMap(
  map: Record<string, IdeFsEntry[]>
): (dirPath: string) => IdeFsEntry[] | undefined {
  return (dirPath) => map[dirPath];
}
