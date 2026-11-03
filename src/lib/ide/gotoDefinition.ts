/**
 * Lightweight go-to-definition: unique basename match (not LSP).
 */

import { normalizeIdeRelPath } from "./citations";
import { languageIdFromPath, type IdeLanguageId } from "./language";

/** Keywords that must not be treated as identifiers. */
export const GOTO_DEF_KEYWORDS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "final",
  "finally",
  "float",
  "for",
  "function",
  "goto",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "int",
  "interface",
  "let",
  "long",
  "native",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "volatile",
  "while",
  "with",
  "yield",
  "async",
  "await",
  "from",
  "as",
  "of",
  "def",
  "elif",
  "except",
  "lambda",
  "pass",
  "raise",
  "None",
  "True",
  "False",
  "ifndef",
  "define",
  "include",
  "pragma",
  "typedef",
  "struct",
  "union",
  "sizeof",
]);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Extensions tried for go-to-definition basename matching. */
export const GOTO_DEF_EXTS = [".java", ".ts", ".js", ".h", ".py"] as const;

export function isGotoDefinitionIdentifier(word: string): boolean {
  if (!word || !IDENT_RE.test(word)) return false;
  if (GOTO_DEF_KEYWORDS.has(word)) return false;
  return true;
}

/** Prefer current file language’s extension, then the rest. */
export function gotoDefExtOrder(currentPath: string): string[] {
  const lang = languageIdFromPath(currentPath);
  const preferred = preferredExtForLang(lang);
  const rest = GOTO_DEF_EXTS.filter((e) => e !== preferred);
  return preferred ? [preferred, ...rest] : [...GOTO_DEF_EXTS];
}

function preferredExtForLang(lang: IdeLanguageId): string | null {
  switch (lang) {
    case "java":
      return ".java";
    case "typescript":
    case "tsx":
      return ".ts";
    case "javascript":
    case "jsx":
      return ".js";
    case "c":
    case "cpp":
      return ".h";
    case "python":
      return ".py";
    default:
      return null;
  }
}

export type GotoDefinitionPlan =
  | { kind: "open"; path: string }
  | { kind: "candidates"; candidates: string[] }
  | { kind: "miss" };

/**
 * Find basename `Word` + preferred extensions in fileIndex.
 * Unique → open; 2–5 → candidates; 0 → miss. Never guesses among many.
 */
export function planGotoDefinition(opts: {
  word: string;
  currentPath: string;
  fileIndex: string[];
}): GotoDefinitionPlan {
  if (!isGotoDefinitionIdentifier(opts.word)) return { kind: "miss" };
  const word = opts.word;
  const order = gotoDefExtOrder(opts.currentPath);

  for (const ext of order) {
    const want = `${word}${ext}`.toLowerCase();
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const raw of opts.fileIndex) {
      const p = normalizeIdeRelPath(raw);
      if (!p || seen.has(p)) continue;
      const base = (p.split("/").pop() || p).toLowerCase();
      if (base === want) {
        seen.add(p);
        hits.push(p);
      }
    }
    if (hits.length === 1) return { kind: "open", path: hits[0]! };
    if (hits.length > 1) {
      return { kind: "candidates", candidates: hits.slice(0, 5) };
    }
  }

  // No preferred-ext unique hit: gather across all goto exts (still unique-only open).
  const allHits: string[] = [];
  const seenAll = new Set<string>();
  const wantBases = new Set(
    GOTO_DEF_EXTS.map((e) => `${word}${e}`.toLowerCase())
  );
  for (const raw of opts.fileIndex) {
    const p = normalizeIdeRelPath(raw);
    if (!p || seenAll.has(p)) continue;
    const base = (p.split("/").pop() || p).toLowerCase();
    if (wantBases.has(base)) {
      seenAll.add(p);
      allHits.push(p);
    }
  }
  if (allHits.length === 1) return { kind: "open", path: allHits[0]! };
  if (allHits.length > 1) {
    return { kind: "candidates", candidates: allHits.slice(0, 5) };
  }
  return { kind: "miss" };
}

/**
 * First line (1-based) with `class Word` / `function Word` / `def Word`, else 1.
 */
export function findDefinitionLine(content: string, word: string): number {
  if (!isGotoDefinitionIdentifier(word) || !content) return 1;
  const re = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_])(?:class|function|def)\s+${word}(?![A-Za-z0-9_])`,
    "m"
  );
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return i + 1;
  }
  return 1;
}

/** Word under cursor / click offset in a line of text (0-based offset). */
export function wordAtOffset(lineText: string, offset: number): string | null {
  if (!lineText) return null;
  const o = Math.max(0, Math.min(offset, lineText.length));
  let start = o;
  let end = o;
  const isId = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  if (o < lineText.length && isId(lineText[o]!)) {
    // ok
  } else if (o > 0 && isId(lineText[o - 1]!)) {
    start = o - 1;
    end = o - 1;
  } else {
    return null;
  }
  while (start > 0 && isId(lineText[start - 1]!)) start--;
  while (end < lineText.length && isId(lineText[end]!)) end++;
  const w = lineText.slice(start, end);
  return isGotoDefinitionIdentifier(w) ? w : null;
}
