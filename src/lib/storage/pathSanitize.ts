/** Shared path sanitization (safe for client + server). No escape outside root. */

export function safeRelPath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}
