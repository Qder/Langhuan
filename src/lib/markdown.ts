import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  // Strip YAML frontmatter for preview
  let body = source;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      body = body.slice(end + 4).replace(/^\r?\n/, "");
    }
  }
  return marked.parse(body, { async: false }) as string;
}
