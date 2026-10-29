import { describe, expect, it } from "vitest";
import {
  locateDynamicHtml,
  locatePreviewClick,
  locateStaticInRange,
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
