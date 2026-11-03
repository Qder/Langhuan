/**
 * IDE explain citations: parse [[path:line]], resolve / jump-plan against tree.
 * Exact relative paths may try openFile even when the explorer folder is collapsed.
 * Does not create files; notes-mode wikilinks are unrelated.
 */

import type { IdeFsEntry } from "./ideFs";
import { isLikelyTextPath } from "./ideFs";
import { languageIdFromPath } from "./language";

export type IdeCitation = {
  /** Project-relative path as written (normalized separators). */
  path: string;
  /** 1-based start line, if present. */
  line?: number;
  /** 1-based inclusive end line, if present. */
  endLine?: number;
  /** Raw matched substring. */
  raw: string;
  /** Start index in the source markdown. */
  index: number;
  /** End index (exclusive) in the source markdown. */
  endIndex: number;
};

export type IdeCitationResolveOk = { ok: true; path: string };
export type IdeCitationResolveMiss = {
  ok: false;
  /** Up to 5 basename candidates from the scanned tree. */
  candidates: string[];
};
export type IdeCitationResolve = IdeCitationResolveOk | IdeCitationResolveMiss;

/** Normalize to forward slashes, strip leading ./ and /. */
export function normalizeIdeRelPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

/**
 * Path looks like a project file (has `/` or a known text / language extension).
 * Rejects package names like `java.util.List` and bare identifiers like `Tree`.
 */
export function isIdeCitationPath(path: string): boolean {
  const p = normalizeIdeRelPath(path);
  if (!p || p.includes("://") || p.includes(" ")) return false;
  // Reject obvious Java/package-style names: dots but no slash, last segment
  // is not a known text extension (e.g. java.util.List).
  if (!p.includes("/") && p.includes(".")) {
    const base = p.split("/").pop() || p;
    const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
    if (!ext || (!isLikelyTextPath(base) && languageIdFromPath(base) === "plaintext")) {
      // `foo.bar.Baz` → plaintext & not likely text
      if (base.split(".").length >= 3) return false;
      if (!isLikelyTextPath(base) && languageIdFromPath(p) === "plaintext") return false;
    }
  }
  if (p.includes("/")) {
    // Still require the leaf to look like a file when it has an extension-ish leaf
    const leaf = p.split("/").pop() || p;
    if (leaf.includes(".") && !isLikelyTextPath(leaf) && languageIdFromPath(leaf) === "plaintext") {
      return false;
    }
    return true;
  }
  // No slash: must have a known text extension / language
  return isLikelyTextPath(p) || languageIdFromPath(p) !== "plaintext";
}

function parseLineSuffix(s: string): { path: string; line?: number; endLine?: number } | null {
  const trimmed = s.trim();
  // path:12-34 or path:12
  const m = trimmed.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (m) {
    const path = normalizeIdeRelPath(m[1]);
    if (!isIdeCitationPath(path)) return null;
    const line = Math.max(1, parseInt(m[2], 10));
    const endLine = m[3] != null ? Math.max(line, parseInt(m[3], 10)) : undefined;
    return { path, line, endLine };
  }
  const path = normalizeIdeRelPath(trimmed);
  if (!isIdeCitationPath(path)) return null;
  return { path };
}

/**
 * Extract clickable IDE citations from explain markdown.
 * Order: primary [[…]], then ide:// links, backticks, fence info strings.
 * Overlapping earlier matches win (later ones skipped if they overlap).
 */
export function parseIdeCitations(markdown: string): IdeCitation[] {
  if (!markdown) return [];
  const found: IdeCitation[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  const take = (raw: string, index: number, parsed: { path: string; line?: number; endLine?: number }) => {
    const endIndex = index + raw.length;
    if (occupied.some((o) => !(endIndex <= o.start || index >= o.end))) return;
    occupied.push({ start: index, end: endIndex });
    found.push({
      path: parsed.path,
      line: parsed.line,
      endLine: parsed.endLine,
      raw,
      index,
      endIndex,
    });
  };

  // 1) Primary [[path:line]] / [[path:start-end]] / [[path]]
  {
    const re = /\[\[([^\[\]]+?)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      const inner = m[1].trim();
      // Skip empty / notes-style without path markers that fail isIdeCitationPath
      const parsed = parseLineSuffix(inner) ?? (() => {
        const path = normalizeIdeRelPath(inner);
        return isIdeCitationPath(path) ? { path } : null;
      })();
      if (!parsed) continue;
      take(m[0], m.index, parsed);
    }
  }

  // 2) Markdown links: [label](ide://path#L42) or #L42-L58
  {
    const re = /\[([^\]]*)\]\(\s*ide:\/\/([^)\s#]+)(?:#(L\d+(?:-L\d+)?))?\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      const pathRaw = m[2];
      const hash = m[3];
      let line: number | undefined;
      let endLine: number | undefined;
      if (hash) {
        const hm = hash.match(/^L(\d+)(?:-L(\d+))?$/i);
        if (hm) {
          line = Math.max(1, parseInt(hm[1], 10));
          if (hm[2]) endLine = Math.max(line, parseInt(hm[2], 10));
        }
      }
      const path = normalizeIdeRelPath(pathRaw);
      if (!isIdeCitationPath(path)) continue;
      take(m[0], m.index, { path, line, endLine });
    }
  }

  // 3) Backticks: `src/foo/Bar.java:12` or `src/foo/Bar.java`
  {
    const re = /`([^`\n]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      const inner = m[1].trim();
      const parsed = parseLineSuffix(inner);
      if (!parsed) continue;
      take(m[0], m.index, parsed);
    }
  }

  // 4) Fence info: ```java src/main/java/com/demo/Tree.java
  {
    const re = /^```[\w.+-]*[ \t]+([^\n`]+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      const pathPart = m[1].trim().split(/\s+/)[0] || "";
      const path = normalizeIdeRelPath(pathPart);
      if (!isIdeCitationPath(path)) continue;
      // raw is just the path token for chip purposes; index at path start
      const pathOffset = m[0].indexOf(pathPart);
      const index = m.index + (pathOffset >= 0 ? pathOffset : 0);
      take(pathPart, index, { path });
    }
  }

  found.sort((a, b) => a.index - b.index);
  return found;
}


/**
 * Deduped citation chips for the assistant message footer.
 * Key is path + start line (no line → path only). When duplicates differ by
 * endLine, keep the wider / first range. Order follows first appearance.
 */
export function listFooterCitations(markdown: string): IdeCitation[] {
  const hits = parseIdeCitations(markdown);
  const out: IdeCitation[] = [];
  const keyIndex = new Map<string, number>();
  for (const c of hits) {
    const key = `${normalizeIdeRelPath(c.path)}\0${c.line ?? ""}`;
    const prev = keyIndex.get(key);
    if (prev == null) {
      keyIndex.set(key, out.length);
      out.push(c);
      continue;
    }
    const existing = out[prev]!;
    // Prefer keeping a range when the duplicate adds endLine
    if (
      c.endLine != null &&
      (existing.endLine == null || c.endLine > existing.endLine)
    ) {
      out[prev] = { ...existing, endLine: c.endLine, raw: c.raw };
    }
  }
  return out;
}

/** Flatten scanned explorer children into unique file paths. */
export function listIdeTreeFiles(
  children: Record<string, IdeFsEntry[]>
): string[] {
  const set = new Set<string>();
  for (const entries of Object.values(children)) {
    for (const e of entries) {
      if (e.kind === "file") set.add(normalizeIdeRelPath(e.path));
    }
  }
  return [...set];
}

export function resolveIdeCitation(
  path: string,
  treeIndex: Record<string, IdeFsEntry[]>
): IdeCitationResolve {
  const want = normalizeIdeRelPath(path);
  const files = listIdeTreeFiles(treeIndex);

  if (files.includes(want)) return { ok: true, path: want };

  // Exact case-insensitive
  const ci = files.find((f) => f.toLowerCase() === want.toLowerCase());
  if (ci) return { ok: true, path: ci };

  const base = want.split("/").pop() || want;
  const sameBase = files.filter((f) => (f.split("/").pop() || f) === base);
  if (sameBase.length === 1) return { ok: true, path: sameBase[0] };
  if (sameBase.length > 1) {
    return { ok: false, candidates: sameBase.slice(0, 5) };
  }

  // Basename case-insensitive
  const sameBaseCi = files.filter(
    (f) => (f.split("/").pop() || f).toLowerCase() === base.toLowerCase()
  );
  if (sameBaseCi.length === 1) return { ok: true, path: sameBaseCi[0] };
  if (sameBaseCi.length > 1) {
    return { ok: false, candidates: sameBaseCi.slice(0, 5) };
  }

  return { ok: false, candidates: [] };
}

/**
 * Ancestor dirs of a project-relative file path (root "" omitted).
 * `src/foo/A.java` → `["src", "src/foo"]`.
 */
export function ideAncestorDirs(filePath: string): string[] {
  const want = normalizeIdeRelPath(filePath);
  const parts = want.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const dirs: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
    dirs.push(acc);
  }
  return dirs;
}

export type IdeCitationJumpPlan =
  | { kind: "try-exact"; path: string }
  | { kind: "open"; path: string }
  | { kind: "candidates"; candidates: string[] }
  | { kind: "miss"; path: string };

/**
 * Decide how to jump to a citation without requiring the explorer folder
 * to be expanded. Paths with `/` that are not yet in the scanned tree
 * become `try-exact` (openFile/readIdeFile confirms on disk).
 */
export function planIdeCitationJump(
  path: string,
  treeIndex: Record<string, IdeFsEntry[]>
): IdeCitationJumpPlan {
  const want = normalizeIdeRelPath(path);
  if (!want || !isIdeCitationPath(want)) {
    return { kind: "miss", path: want || path };
  }

  const files = listIdeTreeFiles(treeIndex);

  const exact =
    files.find((f) => f === want) ??
    files.find((f) => f.toLowerCase() === want.toLowerCase());
  if (exact) {
    return { kind: "open", path: exact };
  }

  // Not scanned yet, but looks like a project-relative file → try read.
  if (want.includes("/")) {
    return { kind: "try-exact", path: want };
  }

  // Basename-only against already-scanned children.
  const base = want.split("/").pop() || want;
  const sameBase = files.filter((f) => (f.split("/").pop() || f) === base);
  if (sameBase.length === 1) return { kind: "open", path: sameBase[0]! };
  if (sameBase.length > 1) {
    return { kind: "candidates", candidates: sameBase.slice(0, 5) };
  }

  const sameBaseCi = files.filter(
    (f) => (f.split("/").pop() || f).toLowerCase() === base.toLowerCase()
  );
  if (sameBaseCi.length === 1) return { kind: "open", path: sameBaseCi[0]! };
  if (sameBaseCi.length > 1) {
    return { kind: "candidates", candidates: sameBaseCi.slice(0, 5) };
  }

  // Bare filename not in tree: still try at project root via read.
  return { kind: "try-exact", path: want };
}

/** Clamp 1-based line into [1, lineCount]; empty doc → 1. */
export function clampIdeLine(line: number, lineCount: number): number {
  const n = Number.isFinite(line) ? Math.floor(line) : 1;
  const max = Math.max(1, lineCount | 0);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

export type IdePendingReveal = {
  path: string;
  line: number;
  endLine?: number;
};

/** Build a pendingReveal from citation lines (1-based); clamps to docLineCount when given. */
export function buildIdePendingReveal(
  path: string,
  line: number | undefined,
  endLine: number | undefined,
  docLineCount?: number
): IdePendingReveal | null {
  if (line == null || !Number.isFinite(line)) {
    return null;
  }
  const count = docLineCount ?? Math.max(1, Math.floor(line), Math.floor(endLine ?? line));
  const start = clampIdeLine(line, count);
  const end =
    endLine != null && Number.isFinite(endLine)
      ? clampIdeLine(endLine, count)
      : undefined;
  return {
    path: normalizeIdeRelPath(path),
    line: start,
    endLine: end != null && end > start ? end : end === start ? start : undefined,
  };
}
