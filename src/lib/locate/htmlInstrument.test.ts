import { describe, expect, it } from "vitest";
import {
  collectLhInsertions,
  findLastBodyCloseIndex,
  instrumentHtmlSrcDoc,
  isInsideForbiddenRawText,
  stripInstrumentation,
} from "./htmlInstrument";

describe("instrumentHtmlSrcDoc", () => {
  it("injects data-lh with original offsets on real elements", () => {
    const src = `<!DOCTYPE html>
<html>
<body>
<h2 id="t">Title</h2>
<p>Hello</p>
</body>
</html>`;
    const { html, count } = instrumentHtmlSrcDoc(src);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/<h2[^>]*data-lh="(\d+)-(\d+)"/);
    expect(html).toMatch(/<p[^>]*data-lh="(\d+)-(\d+)"/);
    // original source untouched conceptually: offsets refer to src
    const m = html.match(/<h2[^>]*data-lh="(\d+)-(\d+)"/);
    expect(m).toBeTruthy();
    const start = Number(m![1]);
    const end = Number(m![2]);
    expect(src.slice(start, start + 3)).toBe("<h2");
    expect(src.slice(end - 5, end)).toBe("</h2>");
  });

  it("does not inject on html/head/body", () => {
    const src = `<html><head><title>x</title></head><body><div>a</div></body></html>`;
    const { html } = instrumentHtmlSrcDoc(src);
    expect(html).not.toMatch(/<html[^>]*data-lh=/);
    expect(html).not.toMatch(/<head[^>]*data-lh=/);
    expect(html).not.toMatch(/<body[^>]*data-lh=/);
    expect(html).toMatch(/<div[^>]*data-lh=/);
    expect(html).toMatch(/<title[^>]*data-lh=/);
  });

  it("does not alter script / style / pre / textarea inner text", () => {
    const src = `<body>
<style>.x{color:red}</style>
<script>const t = "<div>nope</div>";</script>
<pre>line1\nline2</pre>
<textarea>a<b>c</textarea>
<p>ok</p>
</body>`;
    const { html } = instrumentHtmlSrcDoc(src);
    expect(html).toContain('const t = "<div>nope</div>";');
    expect(html).toContain(".x{color:red}");
    expect(html).toContain("line1\nline2");
    expect(html).toContain("a<b>c");
    // start tags themselves may be annotated
    expect(html).toMatch(/<p[^>]*data-lh=/);
  });

  it("skips implicitly created tags (fragment without html/body wrappers still works)", () => {
    const src = `<div class="c"><span>x</span></div>`;
    const { html, count } = instrumentHtmlSrcDoc(src);
    expect(count).toBe(2);
    expect(html).toMatch(/data-lh="/);
  });

  it("handles self-closing-ish void tags", () => {
    const src = `<p>a<img src="x.png" alt="y">b</p>`;
    const { html } = instrumentHtmlSrcDoc(src);
    expect(html).toMatch(/<img[^>]*data-lh="\d+-\d+"[^>]*>/);
  });
});

describe("collectLhInsertions", () => {
  it("returns descending insertion offsets", () => {
    const src = `<p>a</p><p>b</p>`;
    const ins = collectLhInsertions(src);
    expect(ins.length).toBe(2);
    expect(ins[0].at).toBeGreaterThanOrEqual(ins[1].at);
  });
});

describe("stripInstrumentation", () => {
  it("removes data-lh and bridge markers", () => {
    const raw = `<p data-lh="1-2">x</p><script data-lh-bridge="1">/*x*/</script>`;
    const out = stripInstrumentation(raw);
    expect(out).not.toContain("data-lh=");
    expect(out).not.toContain("data-lh-bridge");
    expect(out).toContain("<p>x</p>");
  });
});


describe("findLastBodyCloseIndex", () => {
  it("skips </body> inside script", () => {
    const html = `<body>a</body><script>var t="</body>";</script>`;
    const idx = findLastBodyCloseIndex(html);
    expect(idx).toBe(html.toLowerCase().indexOf("</body>"));
    expect(isInsideForbiddenRawText(html, html.lastIndexOf("</body>"))).toBe(true);
  });
});

describe("stripInstrumentation export safety", () => {
  it("removes data-lh and bridge", () => {
    const html = `<div data-lh="1-2">x</div><script data-lh-bridge="1">noop()</script>`;
    const out = stripInstrumentation(html);
    expect(out).not.toContain("data-lh");
    expect(out).not.toContain("data-lh-bridge");
  });
});
