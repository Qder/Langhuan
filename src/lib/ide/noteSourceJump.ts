/**
 * Resolve a note–source citation against the current project.
 *
 * 1. If the file is still at the stored path and the snapshot sits in the
 *    original line range, jump there.
 * 2. If the snapshot moved inside that file, jump to the new lines.
 * 3. If the path is gone, search the project (bounded) for the snapshot.
 * 4. If it cannot be found uniquely, the caller shows the saved snapshot in
 *    the note — never invents file contents or fails silently.
 */

import { basename } from "../utils";
import { normalizeIdeRelPath } from "./citations";
import type { IdeFsEntry } from "./ideFs";
import { isLikelyTextPath } from "./ideFs";
import { shouldIgnoreName } from "./ignore";
import {
  locateSnippetInFiles,
  snippetInCitedRange,
  type SnippetFile,
  type SnippetHit,
} from "./snippetLocate";
import type { NoteSourceCitation } from "./noteSourceCitation";

export const CITE_PROJECT_SEARCH_MAX_FILES = 400;
export const CITE_PROJECT_SEARCH_MAX_DEPTH = 8;

export type CitationJumpHit = {
  ok: true;
  path: string;
  fromLine: number;
  toLine: number;
  relocated: boolean;
};

export type CitationJumpMiss = {
  ok: false;
  /** Caller must surface the saved snapshot; do not invent a file. */
  showSnapshot: true;
  reason:
    | "no-snapshot"
    | "not-found"
    | "ambiguous"
    | "too-short"
    | "no-file";
};

export type CitationJumpResult = CitationJumpHit | CitationJumpMiss;

export type CitationProjectIo = {
  listDir: (relDir: string) => Promise<IdeFsEntry[]>;
  readFile: (relPath: string) => Promise<string | null>;
};

function miss(
  reason: CitationJumpMiss["reason"]
): CitationJumpMiss {
  return { ok: false, showSnapshot: true, reason };
}

function pickUniqueHit(
  hits: SnippetHit[],
  preferredPath?: string
): SnippetHit | "ambiguous" | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  const preferred = preferredPath ? normalizeIdeRelPath(preferredPath) : "";
  if (preferred) {
    const samePath = hits.filter((h) => h.path === preferred);
    if (samePath.length === 1) return samePath[0]!;
    if (samePath.length > 1) return "ambiguous";
    const leaf = basename(preferred);
    const sameName = hits.filter((h) => basename(h.path) === leaf);
    if (sameName.length === 1) return sameName[0]!;
    if (sameName.length > 1) return "ambiguous";
  }
  return "ambiguous";
}

function hitFrom(
  filePath: string,
  fromLine: number,
  toLine: number,
  relocated: boolean
): CitationJumpHit {
  return {
    ok: true,
    path: filePath,
    fromLine,
    toLine,
    relocated,
  };
}

async function readAsFile(
  io: Pick<CitationProjectIo, "readFile">,
  path: string
): Promise<SnippetFile | null> {
  const norm = normalizeIdeRelPath(path);
  if (!norm) return null;
  try {
    const content = await io.readFile(norm);
    if (content == null) return null;
    return { path: norm, content: content.replace(/\r\n/g, "\n"), startLine: 1 };
  } catch {
    return null;
  }
}

/**
 * Locate the saved snapshot. Prefers the original path, then a bounded
 * project walk when the file has moved.
 */
export async function resolveNoteSourceJump(opts: {
  citation: NoteSourceCitation;
  readFile: (relPath: string) => Promise<string | null>;
  searchProject?: CitationProjectIo;
}): Promise<CitationJumpResult> {
  const path = normalizeIdeRelPath(opts.citation.path);
  const fromLine = opts.citation.fromLine;
  const toLine = Math.max(fromLine, opts.citation.toLine);
  const snapshot = String(opts.citation.snapshot ?? "").replace(/\r\n/g, "\n");
  const io = { readFile: opts.readFile };

  const original = path ? await readAsFile(io, path) : null;

  if (snapshot.trim()) {
    if (
      original &&
      snippetInCitedRange(snapshot, original, fromLine, toLine)
    ) {
      return hitFrom(original.path, fromLine, toLine, false);
    }
    if (original) {
      const inFile = locateSnippetInFiles(snapshot, [original]);
      if (inFile.ok) {
        const picked = pickUniqueHit(inFile.hits, original.path);
        if (picked && picked !== "ambiguous") {
          const relocated =
            picked.path !== original.path ||
            picked.line !== fromLine ||
            picked.endLine !== toLine;
          return hitFrom(picked.path, picked.line, picked.endLine, relocated);
        }
        if (picked === "ambiguous") return miss("ambiguous");
      } else if (inFile.reason === "too-short" || inFile.reason === "empty") {
        // Too short to relocate uniquely: keep the stored lines in this file.
        return hitFrom(original.path, fromLine, toLine, false);
      }
    }
  } else if (original) {
    // No snapshot stored: jump to the recorded lines if the file is still there.
    return hitFrom(original.path, fromLine, toLine, false);
  } else {
    return miss("no-snapshot");
  }

  if (!snapshot.trim()) return miss("no-snapshot");
  if (!opts.searchProject) {
    return original ? miss("not-found") : miss("no-file");
  }

  const found = await searchSnapshotInProject({
    snapshot,
    io: opts.searchProject,
    skipPath: original?.path,
  });
  if (found === "too-short") {
    return original ? hitFrom(original.path, fromLine, toLine, false) : miss("too-short");
  }
  if (!found.length) {
    return original ? miss("not-found") : miss("no-file");
  }
  const located = locateSnippetInFiles(snapshot, found);
  if (!located.ok) {
    return located.reason === "too-short" ? miss("too-short") : miss("not-found");
  }
  const picked = pickUniqueHit(located.hits, path);
  if (!picked || picked === "ambiguous") return miss("ambiguous");
  return hitFrom(picked.path, picked.line, picked.endLine, true);
}

/** Walk the project (bounded) and return text files that may hold the snapshot. */
export async function searchSnapshotInProject(opts: {
  snapshot: string;
  io: CitationProjectIo;
  skipPath?: string;
  maxFiles?: number;
  maxDepth?: number;
}): Promise<SnippetFile[] | "too-short"> {
  const needle = opts.snapshot.replace(/\r\n/g, "\n").trim();
  const probe = locateSnippetInFiles(needle, [{ path: "_probe", content: needle }]);
  if (!probe.ok && (probe.reason === "empty" || probe.reason === "too-short")) {
    return "too-short";
  }

  const maxFiles = Math.max(1, opts.maxFiles ?? CITE_PROJECT_SEARCH_MAX_FILES);
  const maxDepth = Math.max(0, opts.maxDepth ?? CITE_PROJECT_SEARCH_MAX_DEPTH);
  const skip = opts.skipPath ? normalizeIdeRelPath(opts.skipPath) : "";
  const hits: SnippetFile[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];
  const seenDirs = new Set<string>();
  let scanned = 0;

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    let entries: IdeFsEntry[];
    try {
      entries = await opts.io.listDir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldIgnoreName(entry.name)) continue;
      if (entry.kind === "directory") {
        if (depth >= maxDepth) continue;
        queue.push({ dir: entry.path, depth: depth + 1 });
        continue;
      }
      const path = normalizeIdeRelPath(entry.path);
      if (!path || path === skip || !isLikelyTextPath(path)) continue;
      if (scanned >= maxFiles) return hits;
      scanned += 1;
      let content: string | null;
      try {
        content = await opts.io.readFile(path);
      } catch {
        content = null;
      }
      if (content == null) continue;
      const file: SnippetFile = {
        path,
        content: content.replace(/\r\n/g, "\n"),
        startLine: 1,
      };
      const r = locateSnippetInFiles(needle, [file]);
      if (r.ok) hits.push(file);
    }
  }
  return hits;
}

export function jumpMissMessage(reason: CitationJumpMiss["reason"]): string {
  switch (reason) {
    case "no-snapshot":
      return "这条引用没有保存选区快照，无法在工程里重定位；已在笔记中保留原文位置";
    case "ambiguous":
      return "源码中有多处匹配，未自动跳转；已在笔记中显示链接时的快照";
    case "too-short":
      return "选区过短，无法可靠重定位；已在笔记中显示链接时的快照";
    case "no-file":
      return "工程里找不到该文件，已在笔记中显示链接时的快照";
    default:
      return "原文已找不到或已改写，已在笔记中显示链接时的快照";
  }
}
