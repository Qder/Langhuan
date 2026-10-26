/**
 * Rewrite known-broken preview helpers inside user HTML before iframe srcDoc.
 * Never written back to the saved document.
 */

/** Correct colorize: tokenize tags in one pass so attr regex cannot rematch inside spans. */
export const FIXED_COLORIZE_FN = `function colorize(src) {
  var s = escapeHtml(src);
  var holders = [];
  function hold(html) {
    holders.push(html);
    return "\\0H" + (holders.length - 1) + "\\0";
  }
  s = s.replace(/(&lt;!--[\\s\\S]*?--&gt;)/g, function (m) {
    return hold('<span class="cmt">' + m + '</span>');
  });
  s = s.replace(/(^|\\n)(\\/\\/[^\\n]*)/g, function (_, a, b) {
    return a + hold('<span class="cmt">' + b + '</span>');
  });
  s = s.replace(/&lt;(\\/?[a-zA-Z][\\w:-]*)((?:[^&]|&(?!lt;|gt;))*?)(\\/?&gt;)/g, function (_, name, mid, end) {
    var coloredMid = mid.replace(
      /(\\s+)([a-zA-Z_:][\\w:.-]*)(=)(&quot;[\\s\\S]*?&quot;|&#39;[\\s\\S]*?&#39;|"[^"]*"|'[^']*'|[^\\s&]*)/g,
      function (_m, sp, attr, eq, val) {
        return sp + '<span class="attr">' + attr + '</span>' + eq + '<span class="str">' + val + '</span>';
      }
    );
    return '&lt;<span class="tagname">' + name + '</span>' + coloredMid + end;
  });
  s = s.replace(/\\0H(\\d+)\\0/g, function (_, i) {
    return holders[+i];
  });
  return s;
}`;

/**
 * Replace a top-level `function colorize(...) { ... }` in HTML source with FIXED_COLORIZE_FN.
 * Uses brace matching so nested blocks inside the original body are fine.
 */
export function replaceColorizeFunction(html: string): string {
  const re = /function\s+colorize\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  let out = html;
  const replacements: { start: number; end: number }[] = [];

  while ((match = re.exec(html)) !== null) {
    const start = match.index;
    const bodyStart = match.index + match[0].length - 1; // at '{'
    let depth = 0;
    let i = bodyStart;
    let inStr: '"' | "'" | "`" | null = null;
    let escaped = false;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "/" && html[i + 1] === "/") {
        i += 2;
        while (i < html.length && html[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && html[i + 1] === "*") {
        i += 2;
        while (i + 1 < html.length && !(html[i] === "*" && html[i + 1] === "/")) i++;
        i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          replacements.push({ start, end: i + 1 });
          break;
        }
      }
    }
  }

  // Apply from the end so indices stay valid
  for (let r = replacements.length - 1; r >= 0; r--) {
    const { start, end } = replacements[r];
    out = out.slice(0, start) + FIXED_COLORIZE_FN + out.slice(end);
  }
  return out;
}

/** Prepare HTML for iframe preview (mutate helpers only; keep user content intact on disk). */
export function prepareHtmlPreview(src: string): string {
  return replaceColorizeFunction(src);
}

/** Pure reference implementation used by tests (mirrors FIXED_COLORIZE_FN logic). */
export function colorizeFixed(src: string, escapeHtml: (s: string) => string): string {
  let s = escapeHtml(src);
  const holders: string[] = [];
  const hold = (html: string) => {
    holders.push(html);
    return `\0H${holders.length - 1}\0`;
  };
  s = s.replace(/(&lt;!--[\s\S]*?--&gt;)/g, (m) => hold(`<span class="cmt">${m}</span>`));
  s = s.replace(/(^|\n)(\/\/[^\n]*)/g, (_, a, b) => a + hold(`<span class="cmt">${b}</span>`));
  s = s.replace(
    /&lt;(\/?[a-zA-Z][\w:-]*)((?:[^&]|&(?!lt;|gt;))*?)(\/?&gt;)/g,
    (_, name, mid, end) => {
      const coloredMid = mid.replace(
        /(\s+)([a-zA-Z_:][\w:.-]*)(=)(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|"[^"]*"|'[^']'*|[^\s&]*)/g,
        (_m: string, sp: string, attr: string, eq: string, val: string) =>
          `${sp}<span class="attr">${attr}</span>${eq}<span class="str">${val}</span>`
      );
      return `&lt;<span class="tagname">${name}</span>${coloredMid}${end}`;
    }
  );
  s = s.replace(/\0H(\d+)\0/g, (_, i) => holders[+i]);
  return s;
}
