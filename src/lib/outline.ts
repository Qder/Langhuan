import { parseFrontmatter } from "./tags";

export type OutlineHeading = { id: string; text: string; level: number };

/** Extract h1–h3 headings from Markdown source for TOC / 大纲. */
export function extractOutline(md: string): OutlineHeading[] {
  const { body } = parseFrontmatter(md);
  const out: OutlineHeading[] = [];
  for (const line of body.split(/\n/)) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/[#*`]/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "");
    out.push({ id, text, level: m[1].length });
  }
  return out;
}
