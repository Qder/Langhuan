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
