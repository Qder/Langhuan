import type { Document } from "./types";

/** Extensions the library can store as text documents. */
export const IMPORTABLE_EXT_RE = /\.(md|html|txt|svg)$/i;

/** File picker accept list (comma-separated). */
export const IMPORTABLE_ACCEPT =
  ".md,.html,.txt,.svg,text/markdown,text/html,image/svg+xml";

export function isImportableLibraryPath(path: string): boolean {
  return IMPORTABLE_EXT_RE.test(path.replace(/\\/g, "/"));
}

/** Map path extension to Document.type. .svg is stored as html (SVG markup). */
export function libraryDocTypeFromPath(path: string): Document["type"] {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".svg")) return "html";
  return "md";
}

/** Normalize .txt imports to .md paths. */
export function normalizeImportedPath(path: string): string {
  const p = path.replace(/\\/g, "/");
  if (p.toLowerCase().endsWith(".txt")) return p.replace(/\.txt$/i, ".md");
  return p;
}
