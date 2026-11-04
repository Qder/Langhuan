/**
 * Lightweight file outline for the IDE reading rail.
 * Regex-only by design: no LSP, no parser, no index. Covers the shapes we
 * actually read in 读码 (JS/TS, Java/Kotlin/C#, Python, Rust/Go, Markdown).
 */

import { languageIdFromPath, type IdeLanguageId } from "./language";

export type OutlineSymbolKind =
  | "class"
  | "interface"
  | "function"
  | "method"
  | "variable"
  | "heading";

export type OutlineSymbol = {
  name: string;
  kind: OutlineSymbolKind;
  /** 1-based line in the file. */
  line: number;
  /** Nesting hint from leading indentation (0-based). */
  depth: number;
  /** Markdown only: 1–6. */
  level?: number;
};

export const OUTLINE_MAX_SYMBOLS = 400;

type Rule = {
  re: RegExp;
  kind: OutlineSymbolKind;
  /** Which capture group holds the name. */
  group?: number;
};

const JS_RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    kind: "function",
  },
];

const JAVA_RULES: Rule[] = [
  {
    re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*(?:class|record)\s+([A-Za-z_][\w]*)/,
    kind: "class",
  },
  {
    re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed)\s+)*interface\s+([A-Za-z_][\w]*)/,
    kind: "interface",
  },
  {
    re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed)\s+)*enum\s+([A-Za-z_][\w]*)/,
    kind: "interface",
  },
  // method: modifiers+ returnType name(...) — control-flow keywords lack a return type.
  {
    re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|default|override|virtual|async|sealed)\s+)+[\w<>[\],.?\s]+?\s+([A-Za-z_][\w]*)\s*\(/,
    kind: "method",
  },
];

const PYTHON_RULES: Rule[] = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: "function" },
];

const RUST_RULES: Rule[] = [
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union)\s+([A-Za-z_][\w]*)/,
    kind: "class",
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][\w]*)/,
    kind: "function",
  },
];

const GO_RULES: Rule[] = [
  { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/, kind: "function" },
  { re: /^type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/, kind: "class" },
];

const C_RULES: Rule[] = [
  { re: /^\s*(?:typedef\s+)?(?:struct|class|union|enum)\s+([A-Za-z_][\w]*)\s*\{?/, kind: "class" },
  {
    re: /^\s*(?:static\s+|inline\s+|extern\s+|const\s+|unsigned\s+|signed\s+)*[A-Za-z_][\w:<>*&\s]*?\s+([A-Za-z_][\w]*)\s*\([^;]*$/,
    kind: "function",
  },
];

function rulesFor(lang: IdeLanguageId): Rule[] {
  switch (lang) {
    case "javascript":
    case "jsx":
    case "typescript":
    case "tsx":
    case "vue":
      return JS_RULES;
    case "java":
    case "kotlin":
    case "csharp":
    case "scala":
    case "groovy":
      return JAVA_RULES;
    case "python":
      return PYTHON_RULES;
    case "rust":
      return RUST_RULES;
    case "go":
      return GO_RULES;
    case "c":
    case "cpp":
      return C_RULES;
    default:
      return [];
  }
}

/** Drop a leading line-comment marker so annotated lines still match. */
function cleanLine(line: string): string {
  return line.replace(/^\s*(?:\/\/+|\/\*+|\*+)\s?/, "");
}

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/);
  if (!m) return 0;
  // Tabs count as two columns when they head the indentation.
  let cols = 0;
  for (const ch of m[0]) cols += ch === "\t" ? 2 : 1;
  return cols;
}

function depthFromIndent(indent: number): number {
  return Math.min(6, Math.floor(indent / 2));
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Extract a flat, ordered outline. Markdown gets headings only; code gets
 * classes / interfaces / functions / methods. Returns [] when nothing matches
 * (the UI then shows「本文件没有可识别的大纲」).
 */
export function extractFileOutline(
  path: string,
  content: string,
  opts?: { max?: number }
): OutlineSymbol[] {
  if (!content) return [];
  const max = Math.max(1, opts?.max ?? OUTLINE_MAX_SYMBOLS);
  const lang = languageIdFromPath(path);
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  if (lang === "markdown") {
    const out: OutlineSymbol[] = [];
    let fence: string | null = null;
    for (let i = 0; i < lines.length && out.length < max; i++) {
      const raw = lines[i]!;
      // Track fenced code so `# comment` inside ```sh is not a heading.
      const fenceMatch = raw.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        if (fence == null) fence = marker;
        else if (marker.startsWith(fence[0]!) && marker.length >= fence.length) {
          fence = null;
        }
        continue;
      }
      if (fence != null) continue;

      const m = raw.match(MD_HEADING);
      if (!m) continue;
      const name = m[2]!.trim();
      if (!name) continue;
      out.push({
        name,
        kind: "heading",
        line: i + 1,
        depth: m[1]!.length - 1,
        level: m[1]!.length,
      });
    }
    return out;
  }

  const rules = rulesFor(lang);
  if (rules.length === 0) return [];

  const out: OutlineSymbol[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    const line = cleanLine(raw);
    for (const rule of rules) {
      const m = line.match(rule.re);
      if (!m) continue;
      const name = m[rule.group ?? 1];
      if (!name) continue;
      out.push({
        name,
        kind: rule.kind,
        line: i + 1,
        depth: depthFromIndent(indentOf(line)),
      });
      break;
    }
  }
  return out;
}
