import { describe, expect, it } from "vitest";
import {
  locateAttrValueInRange,
  locateDynamicHtml,
  locatePreviewClick,
  locateStaticInRange,
  locateTextRunInRange,
  pickTextRunBounds,
} from "./htmlLocate";
import { normalizeNewlines } from "../utils";

describe("locateStaticInRange", () => {
  it("matches visible text inside an annotated slice (not full-doc indexOf)", () => {
    const source = `<body><h2 id="t">Title</h2><p>Title again</p></body>`;
    const h2Start = source.indexOf("<h2");
    const h2End = source.indexOf("</h2>") + "</h2>".length;
    const hit = locateStaticInRange({
      source,
      text: "Title",
      container: { start: h2Start, end: h2End },
    });
    expect(hit.precision).toBe("exact");
    expect(hit.start).toBeGreaterThanOrEqual(h2Start);
    expect(hit.end).toBeLessThanOrEqual(h2End);
    // text "Title" inside h2, not the second Title in <p>
    expect(source.slice(hit.start, hit.end)).toContain("Title");
    expect(hit.start).toBeLessThan(source.indexOf("<p>"));
  });

  it("respects occurrence inside the slice", () => {
    const source = `<div><span>x</span> foo <span>foo</span> foo</div>`;
    const c0 = source.indexOf("<div");
    const c1 = source.indexOf("</div>") + 6;
    const hit = locateStaticInRange({
      source,
      text: "foo",
      container: { start: c0, end: c1 },
      occurrence: 2,
    });
    expect(hit.precision).toBe("exact");
    const first = source.indexOf("foo");
    const second = source.indexOf("foo", first + 1);
    expect(hit.start).toBe(second);
  });
});

describe("locatePreviewClick", () => {
  it("static h2 mid-text → whole h2 range (tags included), 0 error", () => {
    const source = normalizeNewlines(`<!DOCTYPE html>
<html><body>
<h2 id="sec">Hello World</h2>
<p>Hello World</p>
</body></html>`);
    const h2Start = source.indexOf("<h2");
    const h2End = source.indexOf("</h2>") + "</h2>".length;
    const hit = locatePreviewClick({
      source,
      text: "Hello World",
      container: { start: h2Start, end: h2End },
    });
    expect(hit.precision).toBe("exact");
    expect(hit.start).toBe(h2Start);
    expect(hit.end).toBe(h2End);
    expect(source.slice(hit.start, hit.end)).toBe(
      source.slice(h2Start, h2End)
    );
  });

  it("falls through to script search when text not in slice", () => {
    const source = `<body><div id="main"></div>
<script>
const DATA = [
  {"title":"Card 1"},
  {"title":"Card 2"},
  {"title":"Card 20 target"}
];
</script></body>`;
    const mainStart = source.indexOf('<div id="main"');
    const mainEnd = source.indexOf("</div>") + 6;
    const hit = locatePreviewClick({
      source,
      text: "Card 20 target",
      container: { start: mainStart, end: mainEnd },
      occurrence: 1,
    });
    expect(hit.precision === "script" || hit.precision === "fuzzy").toBe(true);
    expect(source.slice(hit.start, hit.end)).toContain("Card 20 target");
  });

  it("dynamic DATA array: 20th occurrence → 20th item, not 1st", () => {
    const items = Array.from({ length: 25 }, (_, i) => `{"id":${i + 1},"t":"Card"}`);
    const source = `<body><div id="app"></div><script>const DATA=[${items.join(",")}];</script></body>`;
    const c0 = source.indexOf('<div id="app"');
    const c1 = source.indexOf("</div>") + 6;
    const hit = locatePreviewClick({
      source,
      text: "Card",
      container: { start: c0, end: c1 },
      occurrence: 20,
    });
    expect(["script", "fuzzy"].includes(hit.precision)).toBe(true);
    // Count "Card" occurrences in script up to hit.start — should be the 20th
    const script = source.slice(source.indexOf("<script>"));
    const absInScript = hit.start - source.indexOf("<script>");
    const before = script.slice(0, absInScript + 4);
    const count = before.split("Card").length - 1;
    expect(count).toBe(20);
  });

  it("container fallback with 仅定位到所在容器", () => {
    const source = `<body><section id="s"><p>static</p></section></body>`;
    const c0 = source.indexOf("<section");
    const c1 = source.indexOf("</section>") + "</section>".length;
    const hit = locatePreviewClick({
      source,
      text: "totally-not-present-xyz",
      container: { start: c0, end: c1 },
    });
    expect(hit.precision).toBe("container");
    expect(hit.start).toBe(c0);
    expect(hit.end).toBe(c1);
    expect(hit.message).toMatch(/仅定位到所在容器/);
  });

  it("JS-rendered stem: hits script JSON stem, not #list shell (even with annotatedSelf)", () => {
    const stem = "用等值演算法判断公式的类型";
    const source = `<body>
<div id="list"></div>
<script>
const DATA = [
  {"id":1,"stem":"第一题题干占位","options":["A","B"]},
  {"id":2,"stem":"${stem}","options":["A. 永真","B. 永假","C. 可满足"]}
];
</script>
</body>`;
    const c0 = source.indexOf('<div id="list"');
    const c1 = source.indexOf("</div>") + 6;
    const hit = locatePreviewClick({
      source,
      text: stem,
      container: { start: c0, end: c1 },
      occurrence: 2,
      annotatedSelf: false,
    });
    expect(hit.precision).toBe("script");
    expect(source.slice(hit.start, hit.end)).toContain(stem);
    expect(hit.start).toBeGreaterThan(source.indexOf("<script"));
    expect(hit.message).toMatch(/脚本数据中的第/);
    // Must not land on #list container
    expect(hit.start).not.toBe(c0);
  });

  it("annotatedSelf + empty text does not pretend exact on shell — container or none", () => {
    const source = `<body><div id="list"></div><script>const DATA=[{"stem":"x"}];</script></body>`;
    const c0 = source.indexOf('<div id="list"');
    const c1 = source.indexOf("</div>") + 6;
    const hit = locatePreviewClick({
      source,
      text: "",
      container: { start: c0, end: c1 },
      annotatedSelf: true,
    });
    expect(hit.precision).toBe("container");
    expect(hit.message).toMatch(/仅定位到所在容器/);
  });

  it("option B text → options B line in script", () => {
    const source = `<body><div id="list"></div><script>
const DATA=[
  {"stem":"q1","options":["A. aa","B. bb"]},
  {"stem":"q2","options":["A. 永真","B. 永假","C. 可满足"]}
];
</script></body>`;
    const c0 = source.indexOf('<div id="list"');
    const c1 = source.indexOf("</div>") + 6;
    const hit = locatePreviewClick({
      source,
      text: "B. 永假",
      container: { start: c0, end: c1 },
      occurrence: 2,
    });
    expect(["script", "fuzzy"].includes(hit.precision)).toBe(true);
    expect(source.slice(hit.start, hit.end)).toContain("B. 永假");
  });
});

describe("locateDynamicHtml disambiguation", () => {
  it("uses occurrence, not nearest-to-container", () => {
    const source = `<div id="main"></div><script>
const A = "alpha";
const B = "alpha";
const C = "alpha";
</script>`;
    // container near first "alpha"
    const c0 = 0;
    const c1 = source.indexOf("</div>") + 6;
    const hit = locateDynamicHtml({
      source,
      text: "alpha",
      container: { start: c0, end: c1 },
      occurrence: 3,
    });
    const positions: number[] = [];
    let from = 0;
    while (true) {
      const i = source.indexOf("alpha", from);
      if (i < 0) break;
      positions.push(i);
      from = i + 1;
    }
    expect(positions.length).toBe(3);
    expect(hit.start).toBe(positions[2]);
  });
});

/* ------------------------------------------------------------------ *
 * I1: word-level locate from the bridge's caret offset
 * ------------------------------------------------------------------ */

/** [c0, c1) of the element whose start tag contains `needle`. */
function elementRange(source: string, needle: string, closeTag: string) {
  const start = source.indexOf(needle);
  const end = source.indexOf(closeTag, start) + closeTag.length;
  return { start, end };
}

describe("pickTextRunBounds", () => {
  it("picks the latin word under the caret", () => {
    const plain = "alpha beta gamma";
    expect(pickTextRunBounds(plain, 0)).toEqual({ start: 0, end: 5 });
    expect(pickTextRunBounds(plain, 7)).toEqual({ start: 6, end: 10 });
    expect(pickTextRunBounds(plain, 15)).toEqual({ start: 11, end: 16 });
  });

  it("snaps a whitespace caret to the next word, then to the previous one", () => {
    const plain = "alpha   beta";
    expect(pickTextRunBounds(plain, 7)).toEqual({ start: 8, end: 12 });
    expect(pickTextRunBounds("alpha   ", 7)).toEqual({ start: 0, end: 5 });
  });

  it("caps a long CJK run around the caret instead of selecting the sentence", () => {
    const plain = "前".repeat(100) + "中".repeat(60) + "后".repeat(100);
    const bounds = pickTextRunBounds(plain, 130) ?? { start: -1, end: -1 };
    expect(bounds.end - bounds.start).toBe(24);
    expect(bounds.start).toBeLessThanOrEqual(130);
    expect(bounds.end).toBeGreaterThan(130);
  });

  it("keeps short CJK runs whole", () => {
    expect(pickTextRunBounds("前缀 折线图 后缀", 3)).toEqual({ start: 3, end: 6 });
  });

  it("prefers an adjacent word when the caret lands on punctuation", () => {
    const plain = "alpha, beta";
    const bounds = pickTextRunBounds(plain, 5) ?? { start: -1, end: -1 };
    expect(plain.slice(bounds.start, bounds.end)).toBe("beta");
  });

  it("clamps out-of-range offsets and rejects empty text", () => {
    expect(pickTextRunBounds("alpha beta", 9999)).toEqual({ start: 6, end: 10 });
    expect(pickTextRunBounds("alpha beta", -5)).toEqual({ start: 0, end: 5 });
    expect(pickTextRunBounds("", 0)).toBeNull();
    expect(pickTextRunBounds("   ", 1)).toBeNull();
  });
});

describe("locateTextRunInRange", () => {
  it("maps a caret offset through inline markup to the exact word", () => {
    const source = normalizeNewlines(`<p>foo <strong>bar</strong> baz</p>`);
    const container = { start: 0, end: source.length };
    // plain = "foo bar baz"; caret at 8 = start of "baz"
    const hit = locateTextRunInRange({ source, container, plainOffset: 8 });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("baz");
    expect(hit.line).toBe(1);
  });

  it("does not swallow the closing tag of the parent element", () => {
    const source = `<td class="c">前缀 折线图 后缀</td>`;
    const container = { start: 0, end: source.length };
    const plainOffset = "前缀 折线图 后缀".indexOf("折线图");
    const hit = locateTextRunInRange({ source, container, plainOffset });
    expect(source.slice(hit.start, hit.end)).toBe("折线图");
  });

  it("skips script contents so offsets stay aligned with the DOM", () => {
    const source = `<div><script>var a = 1;</script><p>real text</p></div>`;
    const container = { start: 0, end: source.length };
    const hit = locateTextRunInRange({ source, container, plainOffset: 0 });
    expect(source.slice(hit.start, hit.end)).toBe("real");
  });

  it("returns none when the bridge did not supply an offset", () => {
    const source = `<p>hello</p>`;
    const hit = locateTextRunInRange({
      source,
      container: { start: 0, end: source.length },
    });
    expect(hit.precision).toBe("none");
  });

  it("returns none for an element with no rendered text", () => {
    const source = `<img src="a.png" alt="x">`;
    const hit = locateTextRunInRange({
      source,
      container: { start: 0, end: source.length },
      plainOffset: 0,
    });
    expect(hit.precision).toBe("none");
  });
});

describe("locatePreviewClick with plainOffset", () => {
  it("word-level beats the tag-level container range", () => {
    const source = normalizeNewlines(`<h2 id="sec">Hello World</h2>`);
    const container = elementRange(source, "<h2", "</h2>");
    const hit = locatePreviewClick({
      source,
      text: "Hello World",
      container,
      plainOffset: 6,
    });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("World");
  });

  it("falls back to the whole element when no offset arrives (old bridge)", () => {
    const source = normalizeNewlines(`<h2 id="sec">Hello World</h2>`);
    const container = elementRange(source, "<h2", "</h2>");
    const hit = locatePreviewClick({ source, text: "Hello World", container });
    expect(hit.start).toBe(container.start);
    expect(hit.end).toBe(container.end);
  });

  it("works in a long paragraph where tag-level would select hundreds of chars", () => {
    const filler = "填充文字".repeat(40);
    const source = `<p>${filler} 目标词 ${filler}</p>`;
    const container = elementRange(source, "<p>", "</p>");
    const plainOffset = filler.length + 2;
    const hit = locatePreviewClick({
      source,
      text: "填充文字",
      container,
      plainOffset,
    });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("目标词");
    expect(hit.end - hit.start).toBe(3);
    // Way smaller than the tag range it used to select.
    expect(hit.end - hit.start).toBeLessThan(container.end - container.start);
  });
});

/* ------------------------------------------------------------------ *
 * I2: attribute value fallback (img alt / title / aria-label)
 * ------------------------------------------------------------------ */

describe("locateAttrValueInRange", () => {
  const source = `<figure><img src="a.png" alt="折线图"><figcaption>图 1</figcaption></figure>`;

  it("locates the alt value inside the start tag", () => {
    const container = { start: 0, end: source.length };
    const hit = locateAttrValueInRange({
      source,
      container,
      attrName: "alt",
      attrValue: "折线图",
      tag: "img",
    });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("折线图");
    expect(hit.message).toContain("属性 alt");
  });

  it("supports single quotes and unquoted values", () => {
    const single = `<img alt='单引号'>`;
    expect(
      source_run(
        single,
        locateAttrValueInRange({
          source: single,
          container: { start: 0, end: single.length },
          attrName: "alt",
          attrValue: "单引号",
        })
      )
    ).toBe("单引号");

    const bare = `<img alt=bareValue>`;
    expect(
      source_run(
        bare,
        locateAttrValueInRange({
          source: bare,
          container: { start: 0, end: bare.length },
          attrName: "alt",
          attrValue: "bareValue",
        })
      )
    ).toBe("bareValue");
  });

  it("decodes entities when comparing the value", () => {
    const html = `<img alt="A &amp; B">`;
    const hit = locateAttrValueInRange({
      source: html,
      container: { start: 0, end: html.length },
      attrName: "alt",
      attrValue: "A & B",
    });
    expect(html.slice(hit.start, hit.end)).toBe("A &amp; B");
  });

  it("prefers the tag hinted by the bridge", () => {
    const html = `<div title="dup"></div><img title="dup">`;
    const hit = locateAttrValueInRange({
      source: html,
      container: { start: 0, end: html.length },
      attrName: "title",
      attrValue: "dup",
      tag: "img",
    });
    expect(html.slice(hit.start, hit.end)).toBe("dup");
    expect(hit.start).toBeGreaterThan(html.indexOf("<img"));
  });

  it("returns none for missing / invalid input", () => {
    const container = { start: 0, end: source.length };
    expect(
      locateAttrValueInRange({ source, container, attrName: "alt", attrValue: "不存在的图" })
        .precision
    ).toBe("none");
    expect(
      locateAttrValueInRange({ source, container, attrName: 'alt"', attrValue: "折线图" })
        .precision
    ).toBe("none");
    expect(
      locateAttrValueInRange({ source, container: null, attrName: "alt", attrValue: "折线图" })
        .precision
    ).toBe("none");
  });

  it("is reachable from locatePreviewClick for a text-less element", () => {
    const html = `<img src="a.png" alt="折线图">`;
    const hit = locatePreviewClick({
      source: html,
      text: "",
      container: { start: 0, end: html.length },
      attrName: "alt",
      attrValue: "折线图",
      tag: "img",
    });
    expect(hit.precision).toBe("exact");
    expect(html.slice(hit.start, hit.end)).toBe("折线图");
  });
});

function source_run(source: string, hit: { start: number; end: number }): string {
  return source.slice(hit.start, hit.end);
}
