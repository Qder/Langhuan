/**
 * Split Markdown into editable blocks for Typora-like mixed mode MVP.
 * Heuristic: headings start a block; blank-line-separated paragraphs;
 * fenced code stays together.
 */

export type MdBlock = {
  index: number;
  start: number;
  end: number;
  text: string;
};

export function splitMarkdownBlocks(source: string): MdBlock[] {
  if (!source) return [{ index: 0, start: 0, end: 0, text: "" }];
  const blocks: MdBlock[] = [];
  let i = 0;
  const n = source.length;
  let index = 0;

  while (i < n) {
    // skip leading newlines between blocks (keep one visual gap via render)
    if (source[i] === "\n") {
      i += 1;
      continue;
    }
    const start = i;
    // fenced code
    if (source.startsWith("```", i) || source.startsWith("~~~", i)) {
      const fence = source.slice(i, i + 3);
      i += 3;
      const close = source.indexOf("\n" + fence, i);
      if (close < 0) {
        i = n;
      } else {
        i = close + 1 + 3;
        while (i < n && source[i] !== "\n") i += 1;
        if (i < n) i += 1;
      }
    } else if (/^#{1,6}\s/m.test(source.slice(i, i + 8))) {
      // heading line only
      while (i < n && source[i] !== "\n") i += 1;
      if (i < n) i += 1;
    } else {
      // until blank line or next heading/fence at line start
      while (i < n) {
        if (source[i] === "\n") {
          if (i + 1 < n && source[i + 1] === "\n") {
            i += 1;
            break;
          }
          const rest = source.slice(i + 1, i + 9);
          if (/^#{1,6}\s/.test(rest) || rest.startsWith("```") || rest.startsWith("~~~")) {
            i += 1;
            break;
          }
        }
        i += 1;
      }
    }
    const end = i;
    const text = source.slice(start, end).replace(/\n$/, "");
    blocks.push({ index, start, end: start + text.length, text });
    index += 1;
    // consume the blank newline after block
    if (i < n && source[i] === "\n") i += 1;
  }

  if (!blocks.length) {
    return [{ index: 0, start: 0, end: source.length, text: source }];
  }
  return blocks;
}

/** Rebuild full source from block texts (join with blank line). */
export function joinMarkdownBlocks(texts: string[]): string {
  return texts.map((t) => t.replace(/\s+$/, "")).join("\n\n");
}
