import { describe, expect, it } from "vitest";
import {
  colorizeFixed,
  prepareHtmlPreview,
  replaceColorizeFunction,
} from "./fixHtmlPreview";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Broken original from html-elements-reference.html */
function colorizeBroken(src: string) {
  let s = escapeHtml(src);
  s = s.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="cmt">$1</span>');
  s = s.replace(/(^|\n)(\/\/[^\n]*)/g, '$1<span class="cmt">$2</span>');
  s = s.replace(/&lt;(\/?[a-zA-Z][\w:-]*)/g, '&lt;<span class="tagname">$1</span>');
  s = s.replace(/(\s)([a-zA-Z_:][\w:.-]*)(=)/g, '$1<span class="attr">$2</span>$3');
  s = s.replace(/(&quot;[^&]*&quot;|&#39;[^&]*&#39;|"[^"]*"|'[^']*')/g, (m) => {
    if (m.indexOf("class=") === 0) return m;
    return '<span class="str">' + m + "</span>";
  });
  s = s.replace(/&quot;([\s\S]*?)&quot;/g, '<span class="str">&quot;$1&quot;</span>');
  return s;
}

describe("colorizeFixed", () => {
  it("does not rematch class= inside injected spans", () => {
    const src = "<head>\n<title>x</title>\n</head>";
    const broken = colorizeBroken(src);
    // Broken nests/corrupts span class attributes
    expect(broken).toContain('class=<span class="str">"attr"</span>');

    const fixed = colorizeFixed(src, escapeHtml);
    expect(fixed).toContain('<span class="tagname">head</span>');
    expect(fixed).toContain('<span class="tagname">title</span>');
    expect(fixed).not.toContain('class=<span class="str">"attr"</span>');
    expect(fixed).not.toContain('<span class="attr">class</span>');
  });

  it("highlights real attributes and strings", () => {
    const src = '<div class="foo" id=\'bar\'>';
    const fixed = colorizeFixed(src, escapeHtml);
    expect(fixed).toContain('<span class="tagname">div</span>');
    expect(fixed).toContain('<span class="attr">class</span>');
    expect(fixed).toContain('<span class="attr">id</span>');
    expect(fixed).toContain('<span class="str">');
  });

  it("preserves comments", () => {
    const src = "<!-- hello -->\n<div>";
    const fixed = colorizeFixed(src, escapeHtml);
    expect(fixed).toContain('<span class="cmt">');
    expect(fixed).toContain('<span class="tagname">div</span>');
  });
});

describe("replaceColorizeFunction", () => {
  it("swaps the broken colorize in sample-like HTML", () => {
    const html = `<script>
function escapeHtml(s){return s;}
function colorize(src) {
  let s = escapeHtml(src);
  s = s.replace(/&lt;(\\/?[a-zA-Z][\\w:-]*)/g, '&lt;<span class="tagname">$1</span>');
  s = s.replace(/(\\s)([a-zA-Z_:][\\w:.-]*)(=)/g, '$1<span class="attr">$2</span>$3');
  return s;
}
function build(){}
</script>`;
    const out = replaceColorizeFunction(html);
    expect(out).toContain("holders");
    expect(out).toContain("function build()");
    // Original broken sequential attr-after-tagname pattern removed
    expect(out).not.toContain("let s = escapeHtml(src)");
  });

  it("prepareHtmlPreview is idempotent-ish on already-fixed", () => {
    const once = prepareHtmlPreview(
      `function colorize(src){ return src; }\nfunction other(){ return 1; }`
    );
    const twice = prepareHtmlPreview(once);
    expect(twice).toContain("holders");
    expect(twice).toContain("function other()");
  });

  it("rewrites colorize in the real html-elements-reference sample", () => {
    const raw = readFileSync(
      join(__dirname, "__fixtures__", "html-elements-reference.html"),
      "utf8",
    );
    expect(raw).toContain("function colorize(src)");
    const fixed = prepareHtmlPreview(raw);
    expect(fixed).toContain("holders");
    expect(fixed).not.toContain(
      's.replace(/(&lt;!--[\\s\\S]*?--&gt;)/g, \'<span class="cmt">$1</span>\');\n  s = s.replace(/(^|\\n)(\\/\\/[^\\n]*)/g'
    );
    // GROUPS data and build() still present
    expect(fixed).toContain("function build()");
    expect(fixed).toContain("const GROUPS");
  });
});
