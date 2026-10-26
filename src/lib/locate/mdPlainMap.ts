/**
 * Strip Markdown syntax from a source slice and build plain→source index map.
 * map[i] = source index for plain[i]; map[plain.length] = end sentinel (slice length).
 */
export function buildMdPlainMap(sourceSlice: string): { plain: string; map: number[] } {
  const map: number[] = [];
  let plain = "";
  const s = sourceSlice;
  const n = s.length;
  let i = 0;
  let atLineStart = true;

  const push = (srcIdx: number, ch: string) => {
    map.push(srcIdx);
    plain += ch;
  };

  while (i < n) {
    const ch = s[i];

    if (atLineStart) {
      if (ch === "#") {
        while (i < n && s[i] === "#") i += 1;
        if (i < n && s[i] === " ") i += 1;
        atLineStart = false;
        continue;
      }
      if (ch === ">") {
        i += 1;
        if (i < n && (s[i] === " " || s[i] === "\t")) i += 1;
        atLineStart = false;
        continue;
      }
      if ((ch === "-" || ch === "*" || ch === "+") && i + 1 < n && s[i + 1] === " ") {
        i += 2;
        atLineStart = false;
        continue;
      }
      if (/\d/.test(ch)) {
        let j = i;
        while (j < n && /\d/.test(s[j])) j += 1;
        if (j < n && s[j] === "." && j + 1 < n && s[j + 1] === " ") {
          i = j + 2;
          atLineStart = false;
          continue;
        }
      }
      // fenced code marker line
      if (ch === "`" && s.slice(i, i + 3) === "```") {
        while (i < n && s[i] !== "\n") i += 1;
        if (i < n && s[i] === "\n") {
          push(i, "\n");
          i += 1;
          atLineStart = true;
        }
        continue;
      }
      // task list [- ] / [x]
      if (ch === "[" && (s[i + 1] === " " || s[i + 1] === "x" || s[i + 1] === "X") && s[i + 2] === "]" && s[i + 3] === " ") {
        i += 4;
        atLineStart = false;
        continue;
      }
      if (ch === "|") {
        i += 1;
        if (i < n && s[i] === " ") i += 1;
        atLineStart = false;
        continue;
      }
    }

    if (ch === "\n") {
      push(i, "\n");
      i += 1;
      atLineStart = true;
      continue;
    }

    if (ch === "\\" && i + 1 < n) {
      push(i + 1, s[i + 1]);
      i += 2;
      atLineStart = false;
      continue;
    }

    // inline code
    if (ch === "`") {
      let ticks = 0;
      while (i + ticks < n && s[i + ticks] === "`") ticks += 1;
      const closer = s.indexOf("`".repeat(ticks), i + ticks);
      if (closer === -1) {
        push(i, ch);
        i += 1;
        atLineStart = false;
        continue;
      }
      for (let k = i + ticks; k < closer; k++) push(k, s[k]);
      i = closer + ticks;
      atLineStart = false;
      continue;
    }

    // wikilink [[target]] or [[target|label]]
    if (ch === "[" && s[i + 1] === "[") {
      const end = s.indexOf("]]", i + 2);
      if (end !== -1) {
        const inner = s.slice(i + 2, end);
        const pipe = inner.indexOf("|");
        const label = pipe >= 0 ? inner.slice(pipe + 1) : inner;
        const labelStart = pipe >= 0 ? i + 2 + pipe + 1 : i + 2;
        for (let k = 0; k < label.length; k++) push(labelStart + k, label[k]);
        i = end + 2;
        atLineStart = false;
        continue;
      }
    }

    // image ![alt](url) or link [text](url)
    if (ch === "!" && s[i + 1] === "[") {
      const closeBracket = findClosingBracket(s, i + 1);
      if (closeBracket !== -1 && s[closeBracket + 1] === "(") {
        const closeParen = findClosingParen(s, closeBracket + 1);
        if (closeParen !== -1) {
          for (let k = i + 2; k < closeBracket; k++) push(k, s[k]);
          i = closeParen + 1;
          atLineStart = false;
          continue;
        }
      }
    }
    if (ch === "[") {
      const closeBracket = findClosingBracket(s, i);
      if (closeBracket !== -1 && s[closeBracket + 1] === "(") {
        const closeParen = findClosingParen(s, closeBracket + 1);
        if (closeParen !== -1) {
          for (let k = i + 1; k < closeBracket; k++) push(k, s[k]);
          i = closeParen + 1;
          atLineStart = false;
          continue;
        }
      }
    }

    // emphasis * _ ** __ ***
    if (ch === "*" || ch === "_") {
      const marker = ch;
      let count = 0;
      while (i + count < n && s[i + count] === marker) count += 1;
      if (count >= 1 && count <= 3) {
        const close = findClosingEmphasis(s, i + count, marker, count);
        if (close !== -1) {
          const innerStart = i + count;
          const nested = buildMdPlainMap(s.slice(innerStart, close));
          for (let k = 0; k < nested.plain.length; k++) {
            push(innerStart + nested.map[k], nested.plain[k]);
          }
          i = close + count;
          atLineStart = false;
          continue;
        }
      }
    }

    // table pipe
    if (ch === "|") {
      i += 1;
      if (i < n && s[i] === " ") i += 1;
      atLineStart = false;
      continue;
    }

    // skip HTML tags
    if (ch === "<") {
      const gt = s.indexOf(">", i + 1);
      if (gt !== -1 && gt - i < 300 && !/\n/.test(s.slice(i, gt))) {
        i = gt + 1;
        atLineStart = false;
        continue;
      }
    }

    push(i, ch);
    i += 1;
    atLineStart = false;
  }

  map.push(n);
  return { plain, map };
}

function findClosingBracket(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] === "[") depth += 1;
    else if (s[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingEmphasis(s: string, from: number, marker: string, count: number): number {
  const needle = marker.repeat(count);
  let i = from;
  while (i < s.length) {
    if (s[i] === "`") {
      let ticks = 0;
      while (i + ticks < s.length && s[i + ticks] === "`") ticks += 1;
      const c = s.indexOf("`".repeat(ticks), i + ticks);
      if (c === -1) return -1;
      i = c + ticks;
      continue;
    }
    if (s[i] === "[" && s[i + 1] === "[") {
      const end = s.indexOf("]]", i + 2);
      if (end !== -1) {
        i = end + 2;
        continue;
      }
    }
    if (s.slice(i, i + count) === needle) {
      if (count < 3 && i + count < s.length && s[i + count] === marker) {
        i += 1;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

export function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
