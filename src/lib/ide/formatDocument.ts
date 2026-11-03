/**
 * Lightweight document formatter (no Prettier/LSP).
 * Safe for JSON / JS / TS / CSS / MD / plain text.
 */

import { languageIdFromPath, type IdeLanguageId } from "./language";

export type FormatDocumentResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: string };

/** VS Code-style Format Document: Shift+Alt+F (Windows/Linux) / Shift+Option+F (Mac). */
export function isFormatDocumentHotkey(e: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (!e.shiftKey || !e.altKey) return false;
  if (e.metaKey || e.ctrlKey) return false;
  return e.key.toLowerCase() === "f";
}

export function formatDocument(
  path: string,
  text: string
): FormatDocumentResult {
  const lang = languageIdFromPath(path);
  try {
    const next = formatByLanguage(lang, text);
    return { ok: true, text: next, changed: next !== text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg || "格式化失败" };
  }
}

function formatByLanguage(lang: IdeLanguageId, text: string): string {
  if (lang === "json") return formatJson(text);
  if (lang === "markdown") return formatMarkdown(text);
  if (
    lang === "yaml" ||
    lang === "toml" ||
    lang === "shell" ||
    lang === "powershell" ||
    lang === "dockerfile" ||
    lang === "properties" ||
    lang === "plaintext" ||
    lang === "sql"
  ) {
    return formatPlain(text);
  }
  // JS/TS/CSS/HTML/Java/C/… — brace-aware reindent
  return formatBraced(text, 2);
}

export function formatJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "\n";
  const parsed = JSON.parse(trimmed) as unknown;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function formatMarkdown(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  const out = lines.map((line) => line.replace(/[ \t]+$/g, ""));
  let body = out.join("\n");
  body = body.replace(/\n{3,}/g, "\n\n");
  if (body.length && !body.endsWith("\n")) body += "\n";
  return body;
}

export function formatPlain(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  const out = lines.map((line) => line.replace(/[ \t]+$/g, ""));
  let body = out.join("\n");
  if (body.length && !body.endsWith("\n")) body += "\n";
  return body;
}

/**
 * Brace/bracket-aware reindent. Skips strings and comments; does not rewrite
 * expressions — only leading whitespace and trailing spaces.
 */
export function formatBraced(text: string, indentSize = 2): string {
  const pad = " ".repeat(Math.max(1, indentSize));
  const lines = text.split(/\r\n|\n|\r/);
  let depth = 0;
  const out: string[] = [];

  for (const raw of lines) {
    const trimmedRight = raw.replace(/[ \t]+$/g, "");
    const trimmed = trimmedRight.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }

    const lead = leadingCloserCount(trimmed);
    const indentDepth = Math.max(0, depth - lead);
    out.push(pad.repeat(indentDepth) + trimmed);
    depth = Math.max(0, depth + netDepthDelta(trimmed));
  }

  let body = out.join("\n");
  if (body.length && !body.endsWith("\n")) body += "\n";
  return body;
}

function leadingCloserCount(line: string): number {
  let i = 0;
  let n = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "}" || ch === "]" || ch === ")") {
      n++;
      i++;
      continue;
    }
    break;
  }
  return n;
}

/** Net {/[/( minus }/]/) outside strings/comments for one line. */
function netDepthDelta(line: string): number {
  let delta = 0;
  let i = 0;
  let mode: "code" | "sq" | "dq" | "tq" | "block" = "code";

  while (i < line.length) {
    const ch = line[i]!;
    const next = line[i + 1] ?? "";

    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (mode === "sq") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") mode = "code";
      i++;
      continue;
    }
    if (mode === "dq") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') mode = "code";
      i++;
      continue;
    }
    if (mode === "tq") {
      if (ch === "`") mode = "code";
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      break;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      i++;
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      i++;
      continue;
    }
    if (ch === "`") {
      mode = "tq";
      i++;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") delta++;
    else if (ch === "}" || ch === "]" || ch === ")") delta--;
    i++;
  }
  return delta;
}
