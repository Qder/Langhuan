/**
 * Lightweight go-to-definition: basename + Java receiver/type resolve (not LSP).
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
  | { kind: "open"; path: string; /** Symbol to highlight / find line for */ symbol: string }
  | { kind: "candidates"; candidates: string[]; symbol: string }
  | { kind: "miss" };

function uniqueBasenameHits(
  fileIndex: string[],
  word: string,
  exts: readonly string[]
): string[] {
  const wantBases = new Set(exts.map((e) => `${word}${e}`.toLowerCase()));
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const raw of fileIndex) {
    const p = normalizeIdeRelPath(raw);
    if (!p || seen.has(p)) continue;
    const base = (p.split("/").pop() || p).toLowerCase();
    if (wantBases.has(base)) {
      seen.add(p);
      hits.push(p);
    }
  }
  return hits;
}

function planFromHits(hits: string[], symbol: string): GotoDefinitionPlan {
  if (hits.length === 1) return { kind: "open", path: hits[0]!, symbol };
  if (hits.length > 1) {
    return { kind: "candidates", candidates: hits.slice(0, 5), symbol };
  }
  return { kind: "miss" };
}

/**
 * Identifier under cursor plus optional `receiver.` before it
 * (e.g. merchantMapper.selectByCondition → word + receiver).
 */
export function symbolAtOffset(
  lineText: string,
  offset: number
): { word: string; receiver: string | null } | null {
  const word = wordAtOffset(lineText, offset);
  if (!word) return null;
  const o = Math.max(0, Math.min(offset, lineText.length));
  let start = o;
  const isId = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  if (!(o < lineText.length && isId(lineText[o]!))) {
    if (o > 0 && isId(lineText[o - 1]!)) start = o - 1;
    else return { word, receiver: null };
  }
  while (start > 0 && isId(lineText[start - 1]!)) start--;
  // Skip whitespace between `.` and word? Java forbids it usually; still allow.
  let i = start - 1;
  while (i >= 0 && /\s/.test(lineText[i]!)) i--;
  if (i < 0 || lineText[i] !== ".") return { word, receiver: null };
  i--;
  while (i >= 0 && /\s/.test(lineText[i]!)) i--;
  if (i < 0 || !isId(lineText[i]!)) return { word, receiver: null };
  const recvEnd = i + 1;
  let recvStart = i;
  while (recvStart > 0 && isId(lineText[recvStart - 1]!)) recvStart--;
  const receiver = lineText.slice(recvStart, recvEnd);
  if (!isGotoDefinitionIdentifier(receiver)) return { word, receiver: null };
  return { word, receiver };
}

/**
 * Resolve Java field/param/local type for `name`, e.g.
 * `private final MerchantMapper merchantMapper;` → MerchantMapper.
 */
export function resolveJavaTypeOfIdentifier(
  content: string,
  name: string
): string | null {
  if (!isGotoDefinitionIdentifier(name) || !content) return null;
  const lines = content.split("\n");
  // Type may be generic: List<Foo>, Map<A,B>, MerchantMapper
  const typePart =
    String.raw`(?:[\w$.]+(?:\s*<[^;{()>]*>)?(?:\s*\[\s*\])?)`;
  const decl = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_])(?:(?:public|protected|private|static|final|volatile|transient|synchronized)\s+)*${typePart}\s+${name}\s*(?:=|;|,|\))`
  );
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("package ")
    ) {
      continue;
    }
    const m = line.match(decl);
    if (!m) continue;
    // Re-parse type token immediately before name
    const beforeName = line.slice(0, line.search(new RegExp(String.raw`\b${name}\b`)));
    const typeMatch = beforeName.match(
      /([A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)*)\s*(?:<[^;{()>]*>)?(?:\s*\[\s*\])?\s*$/
    );
    if (!typeMatch) continue;
    const raw = typeMatch[1]!.replace(/\s+/g, "");
    const simple = raw.includes(".") ? raw.split(".").pop()! : raw;
    if (!isGotoDefinitionIdentifier(simple)) continue;
    if (GOTO_DEF_KEYWORDS.has(simple)) continue;
    return simple;
  }
  return null;
}

/** Unique TypeName.java (or ordered ext) in index. */
export function findUniqueTypeFile(
  typeName: string,
  currentPath: string,
  fileIndex: string[]
): string | null {
  if (!isGotoDefinitionIdentifier(typeName)) return null;
  const order = gotoDefExtOrder(currentPath);
  for (const ext of order) {
    const hits = uniqueBasenameHits(fileIndex, typeName, [ext]);
    if (hits.length === 1) return hits[0]!;
  }
  const hits = uniqueBasenameHits(fileIndex, typeName, GOTO_DEF_EXTS);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Find basename `Word` + preferred extensions in fileIndex.
 * Also: Java `receiver.method` → resolve field type → Type.java.
 * Unique → open; 2–5 → candidates; 0 → miss. Never guesses among many.
 */
export function planGotoDefinition(opts: {
  word: string;
  currentPath: string;
  fileIndex: string[];
  /** e.g. merchantMapper when cursor is on selectByCondition */
  receiver?: string | null;
  /** Current buffer — used to resolve receiver / variable types */
  currentContent?: string | null;
}): GotoDefinitionPlan {
  if (!isGotoDefinitionIdentifier(opts.word)) return { kind: "miss" };
  const word = opts.word;
  const content = opts.currentContent ?? "";
  const receiver = opts.receiver ?? null;

  // 1) receiver.method → Type of receiver → Type.java (symbol stays method)
  if (receiver && content) {
    const typeName = resolveJavaTypeOfIdentifier(content, receiver);
    if (typeName) {
      const path = findUniqueTypeFile(typeName, opts.currentPath, opts.fileIndex);
      if (path) return { kind: "open", path, symbol: word };
    }
  }

  // 2) word itself is a variable/field → jump to its type file (MerchantMapper merchantMapper)
  if (content && languageIdFromPath(opts.currentPath) === "java") {
    const typeName = resolveJavaTypeOfIdentifier(content, word);
    if (typeName && typeName !== word) {
      const path = findUniqueTypeFile(typeName, opts.currentPath, opts.fileIndex);
      if (path) return { kind: "open", path, symbol: typeName };
    }
  }

  // 3) basename Type.java / Foo.ts …
  const order = gotoDefExtOrder(opts.currentPath);
  for (const ext of order) {
    const hits = uniqueBasenameHits(opts.fileIndex, word, [ext]);
    const plan = planFromHits(hits, word);
    if (plan.kind !== "miss") return plan;
  }

  const allHits = uniqueBasenameHits(opts.fileIndex, word, GOTO_DEF_EXTS);
  return planFromHits(allHits, word);
}

/**
 * Exact definition line (1-based) or null when not found.
 * Matches class/interface/enum/function/def, Java-ish methods, MyBatis XML id=.
 */
export function findDefinitionLineOrNull(
  content: string,
  word: string
): number | null {
  if (!isGotoDefinitionIdentifier(word) || !content) return null;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: RegExp[] = [
    // class / interface / enum / record / function / def
    new RegExp(
      String.raw`(?:^|[^A-Za-z0-9_])(?:class|interface|enum|record|function|def)\s+${escaped}(?![A-Za-z0-9_])`
    ),
    // MyBatis / XML id="selectByCondition"
    new RegExp(String.raw`\bid\s*=\s*["']${escaped}["']`),
    // Java method with modifiers + return type: public List<X> selectByCondition(
    new RegExp(
      String.raw`(?:^|[^A-Za-z0-9_])(?:(?:public|protected|private|static|final|default|synchronized|native|abstract)\s+)+(?:[\w$.]+(?:\s*<[^;{()>]*>)?(?:\s*\[\s*\])?\s+)+${escaped}\s*\(`
    ),
    // Interface / package method: List<Merchant> selectByCondition(  (type then name()
    new RegExp(
      String.raw`(?:^|[^A-Za-z0-9_])[\w$.]+(?:\s*<[^;{()>]*>)?(?:\s*\[\s*\])?\s+${escaped}\s*\(`
    ),
  ];
  const lines = content.split("\n");
  for (const re of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const t = line.trim();
      if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      // Skip clear call sites: something.word(
      const idx = line.search(new RegExp(String.raw`\b${escaped}\s*\(`));
      if (idx > 0) {
        const before = line.slice(0, idx).replace(/\s+$/, "");
        if (/\.$/.test(before)) continue;
      }
      if (re.test(line)) return i + 1;
    }
  }
  return null;
}

/**
 * First definition line (1-based), else 1.
 */
export function findDefinitionLine(content: string, word: string): number {
  return findDefinitionLineOrNull(content, word) ?? 1;
}

/**
 * Ranked candidate paths to scan for a method / XML id when type resolve missed.
 * Prefer *Mapper.java / *Mapper.xml / *Dao.java then other java/xml.
 */
export function candidatePathsForMethodSearch(
  word: string,
  fileIndex: string[],
  prefer: string[] = []
): string[] {
  const normPrefer = prefer
    .map((p) => normalizeIdeRelPath(p))
    .filter(Boolean) as string[];
  const seen = new Set<string>(normPrefer);
  const mapperJava: string[] = [];
  const mapperXml: string[] = [];
  const otherJava: string[] = [];
  const otherXml: string[] = [];
  for (const raw of fileIndex) {
    const p = normalizeIdeRelPath(raw);
    if (!p || seen.has(p)) continue;
    const base = (p.split("/").pop() || p).toLowerCase();
    if (base.endsWith("mapper.java") || base.endsWith("dao.java") || base.endsWith("repository.java")) {
      mapperJava.push(p);
      seen.add(p);
    } else if (base.endsWith("mapper.xml")) {
      mapperXml.push(p);
      seen.add(p);
    } else if (base.endsWith(".java")) {
      otherJava.push(p);
      seen.add(p);
    } else if (base.endsWith(".xml")) {
      otherXml.push(p);
      seen.add(p);
    }
  }
  // Cap total scan to keep F12 snappy
  const rest = [...mapperJava, ...mapperXml, ...otherJava, ...otherXml].slice(0, 80);
  return [...normPrefer, ...rest];
}

/**
 * Scan candidate files for a unique method / id definition of `word`.
 */
export async function searchMethodDefinition(opts: {
  word: string;
  fileIndex: string[];
  readFile: (path: string) => Promise<string>;
  prefer?: string[];
}): Promise<GotoDefinitionPlan> {
  if (!isGotoDefinitionIdentifier(opts.word)) return { kind: "miss" };
  const paths = candidatePathsForMethodSearch(
    opts.word,
    opts.fileIndex,
    opts.prefer ?? []
  );
  const hits: string[] = [];
  for (const p of paths) {
    let body: string;
    try {
      body = await opts.readFile(p);
    } catch {
      continue;
    }
    const line = findDefinitionLineOrNull(body, opts.word);
    if (line != null) hits.push(p);
    if (hits.length > 5) break;
  }
  return planFromHits(hits, opts.word);
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
