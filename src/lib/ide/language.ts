/**
 * Map a project-relative path to a CodeMirror / IDE language id.
 * Extension point: add extensions here (and in languageSupport) for C++ / others.
 */
export type IdeLanguageId =
  | "java"
  | "cpp"
  | "javascript"
  | "typescript"
  | "json"
  | "markdown"
  | "html"
  | "css"
  | "xml"
  | "python"
  | "rust"
  | "go"
  | "plaintext";

export function languageIdFromPath(path: string): IdeLanguageId {
  const base = path.replace(/\\/g, "/").split("/").pop() || path;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "java":
      return "java";
    case "cpp":
    case "cc":
    case "cxx":
    case "c":
    case "h":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "xml":
    case "xsl":
    case "svg":
      return "xml";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    default:
      return "plaintext";
  }
}
