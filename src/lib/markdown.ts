import { marked } from "marked";
import { enrichHeadings } from "./outline";

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
  const html = marked.parse(body, { async: false }) as string;
  return enrichHeadings(html).html;
}

export function renderMarkdownWithOutline(source: string) {
  let body = source;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      body = body.slice(end + 4).replace(/^\r?\n/, "");
    }
  }
  const html = marked.parse(body, { async: false }) as string;
  return enrichHeadings(html);
}
