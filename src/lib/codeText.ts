/** Flatten react-markdown / rehype-highlight code children into source text. */
export function flattenCodeText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenCodeText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return flattenCodeText(props?.children);
  }
  return "";
}

/** Return language id from a `language-*` className, or empty string. */
export function languageFromClassName(className?: string | null): string {
  if (!className) return "";
  return /(?:^|\s)language-([\w+-]+)/.exec(className)?.[1]?.toLowerCase() ?? "";
}

export function isMermaidLanguage(className?: string | null): boolean {
  return languageFromClassName(className) === "mermaid";
}
