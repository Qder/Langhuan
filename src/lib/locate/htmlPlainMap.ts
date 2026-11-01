/**
 * HTML source slice → "the text the DOM gives this element" index map.
 *
 * Why: preview clicks report where inside an annotated element the user clicked
 * (`plainOffset`, a character offset into the element's rendered text). This map
 * turns that offset back into a source offset, giving word-level locate without
 * matching any text back into the source.
 *
 * Contract (must stay in sync with `plainOffsetIn` in bridge.client.js):
 * - tags, comments and raw-text element contents are NOT part of `plain`
 * - entities are decoded; unknown entities stay literal (`&foo;` keeps 5 chars)
 * - whitespace is preserved byte-for-byte (DOM `textContent` does not collapse it)
 * - `map[i]` is the offset inside the slice for `plain[i]`; `map[plain.length]`
 *   is the slice length (end sentinel)
 * - caller passes LF-normalized source (same contract as htmlLocate)
 */

export type HtmlPlainMap = {
  plain: string;
  /** plain index → offset inside the slice; includes a trailing sentinel. */
  map: number[];
  /**
   * plain index → offset just past that character in the slice (entities map to
   * the end of the whole entity). `[map[i], endMap[i])` is the tight source range
   * of one rendered character, which is what word-level locate returns.
   */
  endMap: number[];
};

/** Elements whose text is not rendered as text (skipped by the bridge too). */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "noscript", "template"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

const TAG_NAME_CHAR = /[a-zA-Z0-9:_-]/;

/**
 * Index of the `>` that closes a tag starting at `from`; -1 when unterminated.
 * Quote-aware so `title="a > b"` does not end the tag early.
 */
export function findHtmlTagEnd(slice: string, from: number): number {
  let quote = 0;
  for (let i = from; i < slice.length; i++) {
    const c = slice.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
      continue;
    }
    if (c === 34) {
      quote = 34;
      continue;
    }
    if (c === 39) {
      quote = 39;
      continue;
    }
    if (c === 62) return i;
  }
  return -1;
}

/**
 * Offset just past `</name ...>` for a raw-text element, or slice length.
 * The HTML parser ends raw text at the first matching close tag, so the first
 * hit here is the parser's answer too.
 */
function skipRawText(slice: string, lower: string, from: number, name: string): number {
  const needle = `</${name}`;
  let idx = lower.indexOf(needle, from);
  while (idx >= 0) {
    const after = idx + needle.length;
    const next = slice[after];
    if (next === undefined || next === ">" || /[\s/]/.test(next)) {
      const end = findHtmlTagEnd(slice, after);
      return end < 0 ? slice.length : end + 1;
    }
    idx = lower.indexOf(needle, idx + 2);
  }
  return slice.length;
}

/** Decode one entity starting at `&`; null when it is not a known entity. */
export function decodeEntityAt(
  text: string,
  at: number
): { text: string; end: number } | null {
  const semi = text.indexOf(";", at + 1);
  if (semi < 0 || semi - at > 12) return null;
  const body = text.slice(at + 1, semi);
  if (!body) return null;

  if (body[0] === "#") {
    const hex = body[1] === "x" || body[1] === "X";
    const digits = hex ? body.slice(2) : body.slice(1);
    if (!digits) return null;
    const code = parseInt(digits, hex ? 16 : 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    try {
      return { text: String.fromCodePoint(code), end: semi + 1 };
    } catch {
      return null;
    }
  }

  const named = NAMED_ENTITIES[body.toLowerCase()];
  return named ? { text: named, end: semi + 1 } : null;
}

/** Decode the entities this project's source slices can contain. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "&") {
      const hit = decodeEntityAt(text, i);
      if (hit) {
        out += hit.text;
        i = hit.end;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Build the rendered-text → slice-offset map for one annotated element slice
 * (typically `<h2>…</h2>`, offsets relative to the slice start).
 */
export function buildHtmlPlainMap(slice: string): HtmlPlainMap {
  const map: number[] = [];
  const endMap: number[] = [];
  let plain = "";
  const n = slice.length;
  const lower = slice.includes("<") ? slice.toLowerCase() : "";
  let i = 0;

  const pushChar = (idx: number, ch: string, end: number) => {
    map.push(idx);
    endMap.push(end);
    plain += ch;
  };

  while (i < n) {
    const ch = slice[i];

    if (ch === "<") {
      // Comment: contents are not text in any sense.
      if (slice.startsWith("<!--", i)) {
        const end = slice.indexOf("-->", i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      const next = slice[i + 1];
      // <!doctype>, <![CDATA[…]]>, <?xml …>
      if (next === "!" || next === "?") {
        const end = findHtmlTagEnd(slice, i + 2);
        i = end < 0 ? n : end + 1;
        continue;
      }
      if (next === "/" || (next !== undefined && /[a-zA-Z]/.test(next))) {
        const end = findHtmlTagEnd(slice, i + 2);
        if (end < 0) {
          pushChar(i, ch, i + 1);
          i += 1;
          continue;
        }
        const isClose = next === "/";
        let k = isClose ? i + 2 : i + 1;
        let name = "";
        while (k < end && TAG_NAME_CHAR.test(slice[k])) {
          name += slice[k];
          k += 1;
        }
        const selfClosing = slice[end - 1] === "/";
        i = end + 1;
        if (!isClose && !selfClosing && RAW_TEXT_TAGS.has(name.toLowerCase())) {
          i = skipRawText(slice, lower, i, name.toLowerCase());
        }
        continue;
      }
      // Stray '<' inside text — the parser keeps it as text.
      pushChar(i, ch, i + 1);
      i += 1;
      continue;
    }

    if (ch === "&") {
      const decoded = decodeEntityAt(slice, i);
      if (decoded && decoded.text) {
        for (let k = 0; k < decoded.text.length; k++) pushChar(i, decoded.text[k], decoded.end);
        i = decoded.end;
        continue;
      }
    }

    pushChar(i, ch, i + 1);
    i += 1;
  }

  map.push(n);
  return { plain, map, endMap };
}
