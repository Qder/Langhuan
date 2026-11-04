/**
 * IDE explain: context trim, mock reply, session helpers.
 * No auto-edit; citations only.
 */

import { parseIdeCitations, normalizeIdeRelPath } from "./citations";
import type { IdeFsEntry, IdeFolderSession } from "./ideFs";
import { isLikelyTextPath } from "./ideFs";
import { shouldIgnoreName } from "./ignore";

export const IDE_EXPLAIN_MAX_FULL_LINES = 400;
export const IDE_EXPLAIN_CONTEXT_PAD = 80;

/** Shown when the packaged desktop shell (static UI, no Node server) tries to explain. */
export const TAURI_EXPLAIN_UNAVAILABLE =
  "桌面版没有 Next 服务端，IDE 讲解不可用；请用浏览器 `npm run dev`。";
export const IDE_EXPLAIN_HISTORY_MAX = 20;
export const IDE_EXPLAIN_FILE_INDEX_MAX = 200;
/** When scanned files are below this, optionally BFS from root (still capped). */
export const IDE_EXPLAIN_FILE_INDEX_BFS_THRESHOLD = 30;
/** Max neighbor files from relative + unique Java package imports (plus current = ≤4). */
export const IDE_EXPLAIN_NEIGHBOR_MAX = 3;
/** Neighbor bodies over 400 lines: send only this many head lines. */
export const IDE_EXPLAIN_NEIGHBOR_HEAD_LINES = 160;

export type IdeExplainFilePayload = {
  path: string;
  content: string;
  /** 1-based line number of content[0] in the real file. */
  startLine?: number;
};

export type IdeExplainSelection = {
  /** 1-based inclusive. */
  fromLine: number;
  toLine: number;
  text?: string;
};

export type IdeExplainMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed citation paths snapshot (no secrets). */
  citations?: Array<{ path: string; line?: number; endLine?: number }>;
  /** Files sent with this turn — used to locate fences after reload. */
  files?: IdeExplainFilePayload[];
  mock?: boolean;
  createdAt: number;
};

/** Keep persist blobs from inventing file payloads. */
export function normalizeExplainFilePayloads(
  raw: unknown
): IdeExplainFilePayload[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: IdeExplainFilePayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const path =
      typeof rec.path === "string" ? normalizeIdeRelPath(rec.path) : "";
    if (!path) continue;
    const content = typeof rec.content === "string" ? rec.content : "";
    const startLine =
      typeof rec.startLine === "number" &&
      Number.isFinite(rec.startLine) &&
      rec.startLine >= 1
        ? Math.floor(rec.startLine)
        : 1;
    out.push({ path, content, startLine });
  }
  return out.length ? out : undefined;
}

export const IDE_EXPLAIN_SYSTEM_PROMPT = `你是本工程的讲解助教，只解释知识点，不改代码、不输出 git patch、不编造工程里没有的路径。
每个关键结论请用 [[相对路径:行号]] 或 [[相对路径:起始行-结束行]] 标出源码位置（路径用工程相对路径，含目录）。
代码围栏请写成 \`\`\`语言 相对路径:起始行-结束行 ，围栏正文必须是源码原文（可被点选定位）。
引用必须来自用户消息里的「工程已扫描文件路径」清单，或当前附带的 files 正文；禁止编造清单与 files 之外的路径。
用简洁中文回答。`;

/**
 * Build file payloads for the model. Never sends the whole project tree.
 * Large files (>400 lines): selection±80, or head truncate when no selection.
 */
export function buildExplainFilePayloads(opts: {
  path: string;
  content: string;
  includeFile: boolean;
  includeSelection: boolean;
  selection?: IdeExplainSelection | null;
}): IdeExplainFilePayload[] {
  if (!opts.includeFile && !opts.includeSelection) return [];
  const path = normalizeIdeRelPath(opts.path);
  const lines = opts.content.split("\n");
  const total = lines.length;
  const sel = opts.selection;

  if (opts.includeSelection && sel && sel.fromLine >= 1) {
    const from = Math.max(1, Math.floor(sel.fromLine));
    const to = Math.max(from, Math.floor(sel.toLine || sel.fromLine));
    if (opts.includeFile && total <= IDE_EXPLAIN_MAX_FULL_LINES) {
      return [{ path, content: opts.content, startLine: 1 }];
    }
    const start = Math.max(1, from - IDE_EXPLAIN_CONTEXT_PAD);
    const end = Math.min(total, to + IDE_EXPLAIN_CONTEXT_PAD);
    return [
      {
        path,
        content: lines.slice(start - 1, end).join("\n"),
        startLine: start,
      },
    ];
  }

  if (!opts.includeFile) return [];

  if (total <= IDE_EXPLAIN_MAX_FULL_LINES) {
    return [{ path, content: opts.content, startLine: 1 }];
  }

  // Large file, no selection: send a head window only (never whole tree / whole file).
  const end = Math.min(total, IDE_EXPLAIN_CONTEXT_PAD * 2);
  return [
    {
      path,
      content:
        lines.slice(0, end).join("\n") +
        `\n\n/* … 已截断，全文 ${total} 行；请结合选区再问 … */`,
      startLine: 1,
    },
  ];
}

/**
 * Collect project-relative file paths from already-scanned explorer children.
 * Paths only — never file bodies. Honors ignore names on any path segment.
 */
export function collectScannedFileIndex(
  children: Record<string, IdeFsEntry[]>,
  max = IDE_EXPLAIN_FILE_INDEX_MAX
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entries of Object.values(children)) {
    for (const e of entries) {
      if (e.kind !== "file") continue;
      const p = normalizeIdeRelPath(e.path);
      if (!p) continue;
      if (p.split("/").some((seg) => shouldIgnoreName(seg))) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= max) {
        return out.sort((a, b) => a.localeCompare(b, "en"));
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * If scanned files are sparse, breadth-first list more dirs (ignore + max).
 * On failure, returns the scanned fallback. Does not read file contents.
 */
export async function collectFileIndexWithOptionalBfs(opts: {
  session: IdeFolderSession;
  children: Record<string, IdeFsEntry[]>;
  listDir: (session: IdeFolderSession, relDir: string) => Promise<IdeFsEntry[]>;
  max?: number;
  bfsThreshold?: number;
}): Promise<string[]> {
  const max = opts.max ?? IDE_EXPLAIN_FILE_INDEX_MAX;
  const threshold = opts.bfsThreshold ?? IDE_EXPLAIN_FILE_INDEX_BFS_THRESHOLD;
  const fallback = collectScannedFileIndex(opts.children, max);
  if (fallback.length >= threshold || fallback.length >= max) return fallback;

  try {
    const files = new Set(fallback);
    const queued: string[] = [""];
    const listed = new Set<string>(Object.keys(opts.children));
    let qi = 0;
    while (qi < queued.length && files.size < max) {
      const dir = queued[qi++]!;
      let entries: IdeFsEntry[];
      if (opts.children[dir]) {
        entries = opts.children[dir]!;
      } else {
        entries = await opts.listDir(opts.session, dir);
        listed.add(dir);
      }
      for (const e of entries) {
        if (e.kind === "directory") {
          if (shouldIgnoreName(e.name)) continue;
          const d = normalizeIdeRelPath(e.path);
          if (!listed.has(d) && !queued.includes(d)) queued.push(d);
        } else if (e.kind === "file") {
          const p = normalizeIdeRelPath(e.path);
          if (!p || p.split("/").some((seg) => shouldIgnoreName(seg))) continue;
          files.add(p);
          if (files.size >= max) break;
        }
      }
    }
    return [...files].sort((a, b) => a.localeCompare(b, "en")).slice(0, max);
  } catch {
    return fallback;
  }
}

/** User message body for explain API (files + optional path-only index). */
export function assembleExplainUserContent(
  question: string,
  files: IdeExplainFilePayload[],
  fileIndex?: string[]
): string {
  const blocks = files.map((f) => {
    const start = f.startLine ?? 1;
    return `文件：${f.path}（从第 ${start} 行起）\n\`\`\`\n${f.content}\n\`\`\``;
  });
  const indexBlock =
    fileIndex && fileIndex.length > 0
      ? `工程已扫描文件路径（仅路径、无正文，共 ${fileIndex.length} 条）：\n` +
        fileIndex.map((p) => `- ${p}`).join("\n")
      : "";
  return [`问题：${question || "请讲解当前文件"}`, indexBlock, ...blocks]
    .filter(Boolean)
    .join("\n\n");
}

/** Deterministic mock explain that always cites the given path with a line. */
export function buildMockExplainMarkdown(opts: {
  question: string;
  files: IdeExplainFilePayload[];
  /** Path-only index; when a second file exists, mock also cites it at line 1. */
  fileIndex?: string[];
}): string {
  const primary = opts.files[0];
  const path = primary?.path || "src/Main.java";
  const body = primary?.content || "";
  const lines = body.split("\n");
  const startLine = primary?.startLine ?? 1;
  // Prefer a non-empty line near the top of the snippet.
  let rel = 0;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (lines[i]?.trim()) {
      rel = i;
      break;
    }
  }
  const line = startLine + rel;
  const endLine = Math.min(line + 2, startLine + Math.max(0, lines.length - 1));
  const leaf = path.split("/").pop() || path;
  const q = (opts.question || "").trim() || "这个文件在讲什么";
  const primaryNorm = normalizeIdeRelPath(path);
  const second = (opts.fileIndex || [])
    .map((p) => normalizeIdeRelPath(p))
    .find((p) => p && p !== primaryNorm);

  const snippetLines = lines.slice(rel, Math.min(rel + 3, lines.length)).join("\n");
  const parts = [
    `这是针对「${q}」的本地示例讲解（未配置 API）。`,
    `文件 [[${path}:${line}]]（\`${leaf}\`）是当前上下文的入口；可以从这一带的定义读起。`,
    `若这段逻辑跨了几行，请看 [[${path}:${line}-${endLine}]]：先分清输入、状态和出口，再对照调用方。`,
    snippetLines.trim()
      ? `下面这段是源码原文，没有标路径；点代码块也会按正文定位：\n\n\`\`\`\n${snippetLines}\n\`\`\``
      : "",
    `点上面的路径芯片或代码块会打开工程里的真实文件并滚到对应行；编造路径不会静默乱开。`,
    `配置 \`OPENAI_API_KEY\`（或 IDE 设置里的 Key）后，这里会换成模型流式答复，引用格式不变。`,
  ];
  if (second) {
    parts.push(
      `清单里还有 [[${second}:1]]，可对照阅读（示例讲解顺带引用第二个已扫描文件）。`
    );
  }
  return parts.filter(Boolean).join("\n\n");
}


/** Resolve `./` / `../` (or same-dir include) against the importer file path. */
export function resolveImportAgainstFile(
  fromFile: string,
  spec: string
): string | null {
  const base = normalizeIdeRelPath(fromFile);
  const rel = spec.trim().replace(/\\/g, "/");
  if (!rel || rel.includes("://")) return null;
  // Strip trailing slash-only junk
  if (rel.endsWith("/")) return null;

  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const parts: string[] = dir ? dir.split("/") : [];
  const segs = rel.split("/");
  // Bare "foo.h" from #include → same directory
  if (!rel.startsWith("./") && !rel.startsWith("../") && !rel.startsWith("/")) {
    segs.unshift(".");
  }
  for (const seg of segs) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (shouldIgnoreName(seg)) return null;
    parts.push(seg);
  }
  const out = parts.join("/");
  return out ? normalizeIdeRelPath(out) : null;
}

/** JDK / EE / internal packages never map to course project sources. */
const JAVA_SKIP_PACKAGE_PREFIXES = [
  "java.",
  "javax.",
  "jakarta.",
  "jdk.",
  "sun.",
] as const;

/**
 * `com.demo.Foo` → `com/demo/Foo.java`. Returns null for wildcards, blanks, or skipped JDK packages.
 * Does not parse `import com.foo.*;`.
 */
export function javaImportToSuffix(typeName: string): string | null {
  const raw = typeName.trim();
  if (!raw || raw.includes("*") || raw.includes("/") || raw.includes("\\")) {
    return null;
  }
  // Must look like pkg.Type (at least one dot); reject bare identifiers.
  if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+$/.test(raw)) return null;
  const lower = raw.toLowerCase();
  if (JAVA_SKIP_PACKAGE_PREFIXES.some((p) => lower.startsWith(p))) return null;
  return raw.replace(/\./g, "/") + ".java";
}

/** Exact-or-suffix match in fileIndex; only when uniquely one hit. */
export function matchUniqueJavaImportPath(
  suffix: string,
  fileIndex: string[] | undefined
): string | null {
  if (!suffix || !fileIndex || fileIndex.length === 0) return null;
  const needle = normalizeIdeRelPath(suffix);
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const raw of fileIndex) {
    const p = normalizeIdeRelPath(raw);
    if (!p || seen.has(p)) continue;
    if (p === needle || p.endsWith("/" + needle)) {
      seen.add(p);
      hits.push(p);
      if (hits.length > 1) return null;
    }
  }
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Collect up to 3 project-relative neighbor paths from imports in `content`.
 * Relative `./` `../` / `#include "..."` first; then Java package imports when
 * `fileIndex` has exactly one path ending with the package suffix (e.g. `com/demo/Foo.java`).
 * Skips JDK packages (`java.util.List`), star imports, and ambiguous duplicates.
 * Documented truncation for neighbors: ≤400 lines full; else head 160 lines
 * (see truncateNeighborExplainContent).
 */
export function listNearbyImports(
  path: string,
  content: string,
  fileIndex?: string[]
): string[] {
  if (!content) return [];
  const specs: string[] = [];
  const push = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    specs.push(s);
  };

  // from './x' / from "./x"
  {
    const re = /\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) push(m[1]!);
  }
  // import './x' / import "./Foo.java"  (side-effect / bare string import)
  {
    const re = /\bimport\s+['"](\.\.?\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) push(m[1]!);
  }
  // require('./x')
  {
    const re = /\brequire\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) push(m[1]!);
  }
  // #include "x.h" (not <system>)
  {
    const re = /#include\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) push(m[1]!);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const self = normalizeIdeRelPath(path);
  const pushResolved = (resolved: string | null) => {
    if (!resolved || resolved === self) return false;
    if (resolved.split("/").some((seg) => shouldIgnoreName(seg))) return false;
    if (!isLikelyTextPath(resolved)) return false;
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    out.push(resolved);
    return true;
  };

  for (const spec of specs) {
    if (out.length >= IDE_EXPLAIN_NEIGHBOR_MAX) break;
    pushResolved(resolveImportAgainstFile(path, spec));
  }

  // Java package imports fill remaining slots (relative already preferred).
  if (out.length < IDE_EXPLAIN_NEIGHBOR_MAX && fileIndex && fileIndex.length > 0) {
    const javaRe = /\bimport\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\s*;/g;
    let m: RegExpExecArray | null;
    while (
      (m = javaRe.exec(content)) &&
      out.length < IDE_EXPLAIN_NEIGHBOR_MAX
    ) {
      const suffix = javaImportToSuffix(m[1]!);
      if (!suffix) continue;
      pushResolved(matchUniqueJavaImportPath(suffix, fileIndex));
    }
  }

  return out;
}

/** Truncate a neighbor file body for explain (choice: head 160 when >400 lines). */
export function truncateNeighborExplainContent(content: string): {
  content: string;
  startLine: number;
} {
  const lines = content.split("\n");
  if (lines.length <= IDE_EXPLAIN_MAX_FULL_LINES) {
    return { content, startLine: 1 };
  }
  const head = Math.min(IDE_EXPLAIN_NEIGHBOR_HEAD_LINES, lines.length);
  return {
    content:
      lines.slice(0, head).join("\n") +
      `\n\n/* … 邻文件已截断，全文 ${lines.length} 行（仅送头 ${head} 行）… */`,
    startLine: 1,
  };
}

/**
 * Plan neighbor payloads from imports. Pure: does not read disk.
 * `readContent(path)` returns body or null; failures are listed in `skipped`.
 */
export function planNearbyExplainFiles(opts: {
  path: string;
  content: string;
  enabled: boolean;
  alreadyPaths?: string[];
  /** Scanned paths for unique Java package-import matching. */
  fileIndex?: string[];
  readContent: (relPath: string) => string | null;
}): { files: IdeExplainFilePayload[]; skipped: string[] } {
  if (!opts.enabled) return { files: [], skipped: [] };
  const already = new Set(
    (opts.alreadyPaths || []).map((p) => normalizeIdeRelPath(p))
  );
  const planned = listNearbyImports(opts.path, opts.content, opts.fileIndex);
  const files: IdeExplainFilePayload[] = [];
  const skipped: string[] = [];
  for (const rel of planned) {
    if (already.has(rel)) continue;
    const body = opts.readContent(rel);
    if (body == null) {
      skipped.push(rel);
      continue;
    }
    const trimmed = truncateNeighborExplainContent(body);
    files.push({ path: rel, content: trimmed.content, startLine: trimmed.startLine });
    already.add(rel);
  }
  return { files, skipped };
}

/** Right-click「讲解选区」: no-op when selection is empty / missing. */
export function planExplainSelectionRequest(
  selection: (IdeExplainSelection & { path: string }) | null | undefined
): {
  question: string;
  includeSelection: true;
  includeFile: boolean;
  path: string;
  selection: IdeExplainSelection & { path: string };
} | null {
  if (!selection || !selection.path) return null;
  if (!Number.isFinite(selection.fromLine) || selection.fromLine < 1) return null;
  // Empty CM selection is cleared to null by IdeEditor; require non-empty text.
  if (!(selection.text && selection.text.length > 0)) return null;
  return {
    question: "解释当前选区",
    includeSelection: true,
    includeFile: true,
    path: selection.path,
    selection,
  };
}

export function mockExplainHasCitationTo(
  markdown: string,
  path: string
): boolean {
  const want = normalizeIdeRelPath(path);
  return parseIdeCitations(markdown).some(
    (c) => normalizeIdeRelPath(c.path) === want
  );
}

export function appendExplainMessage(
  history: IdeExplainMessage[],
  msg: IdeExplainMessage,
  max = IDE_EXPLAIN_HISTORY_MAX
): IdeExplainMessage[] {
  return [...history, msg].slice(-max);
}

export function citationsFromMarkdown(content: string) {
  return parseIdeCitations(content).map((c) => ({
    path: c.path,
    line: c.line,
    endLine: c.endLine,
  }));
}

/** Encode a short SSE/text stream body (plain text chunks). */
export function encodeMockExplainStream(text: string): string {
  return text;
}
