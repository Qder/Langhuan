import { describe, expect, it } from "vitest";
import { buildHtmlPlainMap, decodeEntities, decodeEntityAt } from "./htmlPlainMap";
import type { HtmlPlainMap } from "./htmlPlainMap";

/** Tight source text for plain[from, to) — what word-level locate returns. */
function sourceRun(slice: string, m: HtmlPlainMap, from: number, to: number): string {
  if (to <= from) return "";
  return slice.slice(m.map[from], m.endMap[to - 1]);
}

describe("buildHtmlPlainMap", () => {
  it("maps a plain element's text to its source offsets", () => {
    const src = `<p>Hello world</p>`;
    const m = buildHtmlPlainMap(src);
    expect(m.plain).toBe("Hello world");
    expect(sourceRun(src, m, 0, 5)).toBe("Hello");
    expect(sourceRun(src, m, 6, 11)).toBe("world");
    // end sentinel = slice length
    expect(m.map[m.plain.length]).toBe(src.length);
  });

  it("skips nested tags but keeps their text contiguous", () => {
    const src = `<p>foo <em>bar</em> baz</p>`;
    const m = buildHtmlPlainMap(src);
    expect(m.plain).toBe("foo bar baz");
    expect(sourceRun(src, m, 4, 7)).toBe("bar");
    expect(sourceRun(src, m, 8, 11)).toBe("baz");
  });

  it("decodes entities and points the decoded char at the whole entity", () => {
    const src = `<p>a &amp; b</p>`;
    const m = buildHtmlPlainMap(src);
    expect(m.plain).toBe("a & b");
    const amp = m.plain.indexOf("&");
    expect(sourceRun(src, m, amp, amp + 1)).toBe("&amp;");
  });

  it("supports numeric entities and nbsp", () => {
    const { plain } = buildHtmlPlainMap(`<p>&#65;&#x42;&nbsp;c</p>`);
    expect(plain).toBe("AB\u00a0c");
  });

  it("keeps unknown entities literal so DOM text and source agree", () => {
    const { plain } = buildHtmlPlainMap(`<p>&unknown; x</p>`);
    expect(plain).toBe("&unknown; x");
  });

  it("skips comments even when they contain '>' or tags", () => {
    const src = `<p>a<!-- <b>no</b> > still comment -->b</p>`;
    const { plain } = buildHtmlPlainMap(src);
    expect(plain).toBe("ab");
  });

  it("skips script/style/textarea/noscript/template contents", () => {
    const src =
      `<div>a<script>var x = "<b>";</script>b` +
      `<style>.c{content:"d"}</style>` +
      `<textarea>e</textarea>` +
      `<noscript>f</noscript>` +
      `<template>g</template>h</div>`;
    expect(buildHtmlPlainMap(src).plain).toBe("abh");
  });

  it("ends raw text at the first closing tag, like the HTML parser", () => {
    const src = `<div><script>var a = "</script>" + "rest";</script>tail</div>`;
    const { plain } = buildHtmlPlainMap(src);
    expect(plain).toBe(`" + "rest";tail`);
  });

  it("does not treat '>' inside attribute values as the tag end", () => {
    const src = `<p title="a > b">text</p>`;
    const { plain } = buildHtmlPlainMap(src);
    expect(plain).toBe("text");
  });

  it("keeps a stray '<' as text", () => {
    const { plain } = buildHtmlPlainMap(`<p>1 < 2</p>`);
    expect(plain).toBe("1 < 2");
  });

  it("handles void and self-closing elements without swallowing the rest", () => {
    expect(buildHtmlPlainMap(`<p>a<br>b<img src="x.svg">c</p>`).plain).toBe("abc");
    expect(buildHtmlPlainMap(`<div><x-el />tail</div>`).plain).toBe("tail");
  });

  it("keeps map monotonic and complete for a long mixed slice", () => {
    const src = `<td class="c">前缀 <strong>bold</strong> &amp; 后缀</td>`;
    const m = buildHtmlPlainMap(src);
    expect(m.plain).toBe("前缀 bold & 后缀");
    expect(m.map).toHaveLength(m.plain.length + 1);
    expect(m.endMap).toHaveLength(m.plain.length);
    for (let i = 1; i < m.map.length; i++) {
      expect(m.map[i]).toBeGreaterThanOrEqual(m.map[i - 1]);
    }
    for (let i = 1; i < m.endMap.length; i++) {
      expect(m.endMap[i]).toBeGreaterThanOrEqual(m.endMap[i - 1]);
    }
    expect(m.map[m.map.length - 1]).toBe(src.length);
    expect(sourceRun(src, m, 0, 2)).toBe("前缀");
  });

  it("returns an empty plain map for an empty slice", () => {
    expect(buildHtmlPlainMap("")).toEqual({ plain: "", map: [0], endMap: [] });
  });

  it("round-trips a word through plain → source offsets", () => {
    const src = `<p>alpha beta <em>gamma</em> delta</p>`;
    const m = buildHtmlPlainMap(src);
    const at = m.plain.indexOf("gamma");
    expect(at).toBeGreaterThan(0);
    expect(sourceRun(src, m, at, at + "gamma".length)).toBe("gamma");
  });
});

describe("decodeEntities", () => {
  it("decodes the supported set and leaves the rest alone", () => {
    expect(decodeEntities("&lt;b&gt; &quot;x&quot; &apos;y&apos; &amp; &nbsp;")).toBe(
      `<b> "x" 'y' & \u00a0`
    );
    expect(decodeEntities("no entities")).toBe("no entities");
    expect(decodeEntities("&bogus; &#xZZ;")).toBe("&bogus; &#xZZ;");
  });
});

describe("decodeEntityAt", () => {
  it("rejects unterminated and out-of-range entities", () => {
    expect(decodeEntityAt("&amp", 0)).toBeNull();
    expect(decodeEntityAt("&#x110000;", 0)).toBeNull();
    expect(decodeEntityAt("&;", 0)).toBeNull();
  });
});
