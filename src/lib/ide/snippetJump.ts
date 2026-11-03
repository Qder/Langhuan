/**
 * Jump a parsed explain fence: verify cited path:line, search snapshot/tabs,
 * then re-read those files from disk on miss. Never scans the whole tree.
 */

import { normalizeIdeRelPath } from "./citations";
import {
  locateSnippetInFiles,
  mergeSnippetCorpus,
  overlaySnippetCorpus,
  snippetInCitedRange,
  type ExplainFence,
  type SnippetFile,
  type SnippetHit,
  type SnippetLocateResult,
} from "./snippetLocate";

export type ReadSnippetFile = (path: string) => Promise<string>;

function citedHit(path: string, line: number, endLine?: number): SnippetHit {
  return {
    path,
    line,
    endLine: endLine ?? line,
    precision: "exact",
  };
}

async function loadPath(opts: {
  path: string;
  tabs: SnippetFile[];
  snapshot: SnippetFile[];
  readFile?: ReadSnippetFile;
}): Promise<SnippetFile | null> {
  const path = normalizeIdeRelPath(opts.path);
  if (!path) return null;
  const tab = opts.tabs.find((f) => f.path === path);
  if (tab) return tab;
  if (opts.readFile) {
    try {
      const content = await opts.readFile(path);
      return {
        path,
        content: content.replace(/\r\n/g, "\n"),
        startLine: 1,
      };
    } catch {
      /* fall through to snapshot */
    }
  }
  return opts.snapshot.find((f) => f.path === path) ?? null;
}

async function loadFullPaths(opts: {
  paths: string[];
  tabs: SnippetFile[];
  snapshot: SnippetFile[];
  readFile?: ReadSnippetFile;
}): Promise<SnippetFile[]> {
  const out: SnippetFile[] = [];
  for (const raw of opts.paths) {
    const file = await loadPath({
      path: raw,
      tabs: opts.tabs,
      snapshot: opts.snapshot,
      readFile: opts.readFile,
    });
    if (file) out.push(file);
  }
  return out;
}

/**
 * Locate a fence. Prefer a verified path:line citation; otherwise substring
 * search snapshot+tabs; on miss, re-read those paths (and the fence path).
 */
export async function locateExplainFence(opts: {
  fence: ExplainFence;
  snapshot?: SnippetFile[];
  tabs?: SnippetFile[];
  readFile?: ReadSnippetFile;
}): Promise<SnippetLocateResult> {
  const tabs = mergeSnippetCorpus(opts.tabs, undefined);
  const snapshot = mergeSnippetCorpus(opts.snapshot, undefined);
  const initial = overlaySnippetCorpus(snapshot, tabs);

  if (opts.fence.path && opts.fence.line != null) {
    const cited = await loadPath({
      path: opts.fence.path,
      tabs,
      snapshot,
      readFile: opts.readFile,
    });
    if (
      cited &&
      snippetInCitedRange(
        opts.fence.body,
        cited,
        opts.fence.line,
        opts.fence.endLine
      )
    ) {
      const hit = citedHit(cited.path, opts.fence.line, opts.fence.endLine);
      return {
        ok: true,
        path: hit.path,
        line: hit.line,
        endLine: hit.endLine,
        precision: "exact",
        hits: [hit],
      };
    }
  }

  const first = locateSnippetInFiles(opts.fence.body, initial);
  if (first.ok || first.reason === "empty" || first.reason === "too-short") {
    return first;
  }

  const paths = new Set<string>();
  for (const f of initial) paths.add(f.path);
  if (opts.fence.path) {
    const p = normalizeIdeRelPath(opts.fence.path);
    if (p) paths.add(p);
  }
  if (!opts.readFile || paths.size === 0) return first;

  const full = await loadFullPaths({
    paths: [...paths],
    tabs,
    snapshot,
    readFile: opts.readFile,
  });
  return locateSnippetInFiles(opts.fence.body, full);
}
