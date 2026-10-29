/** Length of YAML frontmatter prefix including closing fence, relative to full source. */
export function frontmatterOffset(content: string): number {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? m[0].length : 0;
}

export function lineAtOffset(source: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/** How many lines the body is shifted by YAML frontmatter (0 when none). */
export function frontmatterLineOffset(content: string): number {
  const off = frontmatterOffset(content);
  if (!off) return 0;
  // newlines in the prefix == line delta for 1-based body lines
  let lines = 0;
  for (let i = 0; i < off; i++) {
    if (content[i] === "\n") lines += 1;
  }
  return lines;
}
