/**
 * Loads the generated locate bridge IIFE into an isolated JSDOM and asserts
 * postMessage payloads with strict shape checks.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { buildInstrumentedSrcDoc } from "./bridge";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";
import { locatePreviewClick } from "./htmlLocate";
import { buildCssIndex, resolveCssHits, specificityOf, type RawCssHit } from "./cssLocate";
import { inlineProjectHtml } from "../inlineProject";
import { normalizeNewlines } from "../utils";

type Msg = Record<string, unknown>;

function bridgeBody(): string {
  const m = HTML_LOCATE_BRIDGE.match(/<script[^>]*>([\s\S]*)<\/script>/i);
  if (!m) throw new Error("HTML_LOCATE_BRIDGE missing script");
  return m[1];
}

function polyfillRange(win: JSDOM["window"]) {
  const proto = win.Range.prototype as unknown as {
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };
  if (typeof proto.getBoundingClientRect !== "function") {
    proto.getBoundingClientRect = function () {
      return {
        top: 0,
        left: 0,
        bottom: 10,
        right: 40,
        width: 40,
        height: 10,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  }
  if (typeof proto.getClientRects !== "function") {
    proto.getClientRects = function () {
      const list = [this.getBoundingClientRect!()] as unknown as DOMRectList;
      return list;
    };
  }
}

function stubBox(
  el: Element,
  box: { top: number; left: number; width: number; height: number }
) {
  const { top, left, width, height } = box;
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        top,
        left,
        width,
        height,
        bottom: top + height,
        right: left + width,
        x: left,
        y: top,
        toJSON() {
          return {};
        },
      }) as DOMRect,
  });
}

function loadBridge(bodyHtml: string) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
    {
      url: "https://langhuan.test/preview",
      pretendToBeVisual: true,
      runScripts: "outside-only",
    }
  );
  const win = dom.window;
  polyfillRange(win);
  const messages: Msg[] = [];
  Object.defineProperty(win, "parent", {
    configurable: true,
    value: {
      postMessage(data: unknown) {
        if (data && typeof data === "object") messages.push(data as Msg);
      },
    },
  });
  // Ensure rAF exists
  if (typeof win.requestAnimationFrame !== "function") {
    win.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(performance.now()), 0)) as typeof win.requestAnimationFrame;
  }
  win.eval(bridgeBody());
  return { dom, win, doc: win.document, messages };
}

function leftClick(win: JSDOM["window"], el: Element, opts: { x?: number; y?: number; detail?: number } = {}) {
  const x = opts.x ?? 10;
  const y = opts.y ?? 10;
  el.dispatchEvent(
    new win.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  );
  el.dispatchEvent(
    new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      detail: opts.detail ?? 1,
    })
  );
}

function rightClick(win: JSDOM["window"], el: Element, opts: { x?: number; y?: number } = {}) {
  const x = opts.x ?? 40;
  const y = opts.y ?? 50;
  return el.dispatchEvent(
    new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: x,
      clientY: y,
    })
  );
}

function setSel(doc: Document, node: Node, start: number, end: number) {
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = doc.defaultView!.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function onlyLocate(messages: Msg[]) {
  return messages.filter((m) => m.type === "lh-locate");
}
function onlyCtx(messages: Msg[]) {
  return messages.filter((m) => m.type === "lh-contextmenu");
}

describe("bridge jsdom: click → lh-locate", () => {
  it("click normal element posts lh-locate with innermost data-lh range", () => {
    const { messages, doc, win } = loadBridge(`<p data-lh="10-25" id="p1">Hello paragraph</p>`);
    messages.length = 0;
    leftClick(win, doc.getElementById("p1")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0]).toEqual({
      type: "lh-locate",
      text: expect.any(String),
      textSnippet: expect.any(String),
      before: "",
      after: "",
      tagPath: expect.any(String),
      range: { start: 10, end: 25 },
      tag: "p",
      id: "p1",
      annotatedSelf: true,
      occurrence: expect.any(Number),
      metaKey: false,
      ctrlKey: false,
      detail: 1,
    });
  });

  it("click nested strong inside td uses strong's data-lh, not the td", () => {
    const { messages, doc, win } = loadBridge(
      `<table><tr><td data-lh="100-200" id="td1">prefix <strong data-lh="120-140" id="s1">Bold</strong> tail</td></tr></table>`
    );
    messages.length = 0;
    leftClick(win, doc.getElementById("s1")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0].range).toEqual({ start: 120, end: 140 });
    expect(locate[0].tag).toBe("strong");
    expect(locate[0].annotatedSelf).toBe(true);
  });

  it("click nested a inside li: preventDefault, no lh-locate (interactive)", () => {
    const { messages, doc, win } = loadBridge(
      `<ul><li data-lh="50-90" id="li1">See <a data-lh="60-80" id="a1" href="https://example.com/x">link</a></li></ul>`
    );
    messages.length = 0;
    const a = doc.getElementById("a1")!;
    a.dispatchEvent(
      new win.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 })
    );
    const ev = new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
      detail: 1,
    });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onlyLocate(messages)).toEqual([]);
  });

  it("交互元素不定位，但仍报 lh-element（元素检视要能开）", () => {
    const { messages, doc, win } = loadBridge(
      `<ul id="list"><li id="li1">x <button id="btn" class="primary" data-lh="30-90">保存</button></li></ul>`
    );
    messages.length = 0;
    leftClick(win, doc.getElementById("btn")!);

    // 定位照旧跳过：button 的文字不是「这段文案来自源码哪里」的好线索
    expect(onlyLocate(messages)).toEqual([]);
    const probe = messages.find((m) => m.type === "lh-element")!;
    expect(probe).toBeTruthy();
    expect(probe.element).toMatchObject({ tag: "button", id: "btn", classes: ["primary"] });
    expect((probe.ancestors as Array<{ tag: string }>).map((a) => a.tag)).toEqual(["li", "ul", "body"]);
    // 抽屉的 HTML 段靠这个区间给出精确行号
    expect(probe.range).toEqual({ start: 30, end: 90 });
    expect(probe.text).toContain("保存");
  });

  it("click blank element with no data-lh and no text → no lh-locate", () => {
    const { messages, doc, win } = loadBridge(`<div id="bare"></div><p data-lh="1-5" id="other">Other</p>`);
    messages.length = 0;
    leftClick(win, doc.getElementById("bare")!);
    expect(onlyLocate(messages)).toEqual([]);
  });

  it("click with selection intersecting target skips locate; selection elsewhere does not block", () => {
    const { messages, doc, win } = loadBridge(
      `<p data-lh="10-30" id="p1">Selectable text here</p><p data-lh="40-60" id="p2">Other block text</p>`
    );
    setSel(doc, doc.getElementById("p1")!.firstChild!, 0, 9);
    messages.length = 0;
    leftClick(win, doc.getElementById("p1")!);
    expect(onlyLocate(messages)).toEqual([]);

    messages.length = 0;
    leftClick(win, doc.getElementById("p2")!);
    expect(onlyLocate(messages)).toHaveLength(1);
    expect(onlyLocate(messages)[0].range).toEqual({ start: 40, end: 60 });
  });
});

describe("bridge jsdom: contextmenu → lh-contextmenu", () => {
  it("right-click with selection posts lh-contextmenu with coords + range", () => {
    const { messages, doc, win } = loadBridge(`<p data-lh="10-40" id="p1">Context menu selection text</p>`);
    setSel(doc, doc.getElementById("p1")!.firstChild!, 0, 7);
    messages.length = 0;
    const el = doc.getElementById("p1")!;
    const ev = new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 42,
      clientY: 77,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const cm = onlyCtx(messages);
    expect(cm).toHaveLength(1);
    expect(cm[0]).toEqual({
      type: "lh-contextmenu",
      text: expect.any(String),
      textSnippet: expect.any(String),
      before: expect.any(String),
      after: expect.any(String),
      tagPath: expect.any(String),
      x: 42,
      y: 77,
      rect: expect.objectContaining({
        top: expect.any(Number),
        left: expect.any(Number),
        bottom: expect.any(Number),
        right: expect.any(Number),
      }),
      range: { start: 10, end: 40 },
      tag: "p",
      annotatedSelf: expect.any(Boolean),
    });
    expect(String(cm[0].text).length).toBeGreaterThan(0);
  });

  it("right-click without selection on data-lh still posts lh-contextmenu", () => {
    const { messages, doc, win } = loadBridge(`<p data-lh="5-15" id="p1">No selection path</p>`);
    doc.defaultView!.getSelection()!.removeAllRanges();
    messages.length = 0;
    rightClick(win, doc.getElementById("p1")!, { x: 11, y: 22 });
    const cm = onlyCtx(messages);
    expect(cm).toHaveLength(1);
    expect(cm[0]).toEqual({
      type: "lh-contextmenu",
      text: "",
      textSnippet: expect.any(String),
      before: "",
      after: "",
      tagPath: "",
      x: 11,
      y: 22,
      range: { start: 5, end: 15 },
      tag: "p",
      annotatedSelf: true,
    });
  });

  it("right-click with no selection and no data-lh posts nothing", () => {
    const { messages, doc, win } = loadBridge(`<div id="bare">plain</div>`);
    doc.defaultView!.getSelection()!.removeAllRanges();
    messages.length = 0;
    rightClick(win, doc.getElementById("bare")!);
    expect(onlyCtx(messages)).toEqual([]);
  });
});

describe("bridge jsdom: scrollToRange / highlightRange / clearHighlight", () => {
  it("scrollToRange shows overlay; clearHighlight hides it", () => {
    const { doc, win } = loadBridge(
      `<div style="height:2000px"></div><p data-lh="100-120" id="target">Target block</p><div style="height:2000px"></div>`
    );
    const target = doc.getElementById("target")!;
    stubBox(target, { top: 800, left: 0, width: 100, height: 20 });
    Object.defineProperty(win, "innerHeight", { configurable: true, value: 600 });

    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "scrollToRange", range: { start: 100, end: 120 } },
      })
    );
    const overlay = doc.querySelector("[data-lh-overlay]") as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.style.display).toBe("block");

    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "clearHighlight" } }));
    expect(overlay.style.display).toBe("none");
  });

  it("highlightRange shows overlay", () => {
    const { doc, win } = loadBridge(`<p data-lh="1-8" id="t">Hi</p>`);
    stubBox(doc.getElementById("t")!, { top: 10, left: 10, width: 40, height: 16 });
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "highlightRange", range: { start: 1, end: 8 } },
      })
    );
    const overlay = doc.querySelector("[data-lh-overlay]") as HTMLElement;
    expect(overlay.style.display).toBe("block");
  });
});

describe("bridge jsdom: lh-scroll-anchors", () => {
  it("scroll reports anchors sorted by Y with correct shape", async () => {
    const { messages, doc, win } = loadBridge(
      `<p data-lh="10-20" id="a">A</p><p data-lh="30-40" id="b">B</p><p data-lh="50-60" id="c">C</p><p data-lh="70-80" id="d">D</p><p data-lh="90-100" id="e">E</p>`
    );
    const se = doc.scrollingElement || doc.documentElement;
    Object.defineProperty(se, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(se, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(se, "scrollTop", { configurable: true, writable: true, value: 100 });
    stubBox(se, { top: 0, left: 0, width: 100, height: 400 });
    stubBox(doc.getElementById("a")!, { top: 0, left: 0, width: 10, height: 10 });
    stubBox(doc.getElementById("b")!, { top: 50, left: 0, width: 10, height: 10 });
    stubBox(doc.getElementById("c")!, { top: 100, left: 0, width: 10, height: 10 });
    stubBox(doc.getElementById("d")!, { top: 150, left: 0, width: 10, height: 10 });
    stubBox(doc.getElementById("e")!, { top: 200, left: 0, width: 10, height: 10 });

    messages.length = 0;
    doc.dispatchEvent(new win.Event("scroll", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const anchorsMsg = messages.filter((m) => m.type === "lh-scroll-anchors");
    expect(anchorsMsg.length).toBeGreaterThanOrEqual(1);
    const msg = anchorsMsg[anchorsMsg.length - 1];
    expect(msg.type).toBe("lh-scroll-anchors");
    expect(typeof msg.viewportTop).toBe("number");
    expect(typeof msg.percent).toBe("number");
    expect(typeof msg.scrollHeight).toBe("number");
    expect(typeof msg.clientHeight).toBe("number");
    expect(typeof msg.spanTop).toBe("number");
    expect(typeof msg.spanBottom).toBe("number");
    expect(Array.isArray(msg.anchors)).toBe(true);
    expect(Object.keys(msg).sort()).toEqual(
      ["anchors", "clientHeight", "percent", "scrollHeight", "spanBottom", "spanTop", "type", "viewportTop"].sort()
    );
    const anchors = msg.anchors as Array<{ range: { start: number; end: number }; top: number }>;
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i].top).toBeGreaterThanOrEqual(anchors[i - 1].top);
    }
    for (const a of anchors) {
      expect(a).toEqual({
        range: { start: expect.any(Number), end: expect.any(Number) },
        top: expect.any(Number),
      });
    }
  });
});


describe("bridge jsdom: quiz list / set-open / peeked", () => {
  const QUIZ_BODY = `
<details open data-lh="10-80" id="q1"><summary>题干：What is 2+2?</summary><div class="answer">答案：4</div></details>
<details data-lh="81-150" id="q2"><summary>题干：What is 3+3?</summary><div class="answer">答案：6</div></details>
`;

  it("lh-quiz-list returns id/stem/open for each details", () => {
    const { messages, win } = loadBridge(QUIZ_BODY);
    messages.length = 0;
    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "lh-quiz-list" } }));
    const list = messages.filter((m) => m.type === "lh-quiz-list");
    expect(list).toHaveLength(1);
    const items = list[0].items as Array<{ id: string; stem: string; open: boolean }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "10-80", stem: "题干：What is 2+2?", open: true });
    expect(items[1]).toMatchObject({ id: "81-150", stem: "题干：What is 3+3?", open: false });
  });

  it("lh-quiz-set-open all:false collapses every details (open false)", () => {
    const { doc, win, messages } = loadBridge(QUIZ_BODY);
    const details = [...doc.querySelectorAll("details")] as HTMLDetailsElement[];
    expect(details[0].open).toBe(true);
    messages.length = 0;
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "lh-quiz-set-open", all: true, open: false },
      })
    );
    expect(details.every((d) => d.open === false)).toBe(true);
    // mirrors golden details-quiz.html: 全部收起后全部 open 为 false
    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "lh-quiz-list" } }));
    const items = (messages.find((m) => m.type === "lh-quiz-list")!.items as Array<{ open: boolean }>);
    expect(items.every((i) => i.open === false)).toBe(true);
  });

  it("lh-quiz-set-open all:true expands every details", () => {
    const { doc, win } = loadBridge(QUIZ_BODY);
    const details = [...doc.querySelectorAll("details")] as HTMLDetailsElement[];
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "lh-quiz-set-open", all: true, open: true },
      })
    );
    expect(details.every((d) => d.open === true)).toBe(true);
  });

  it("lh-quiz-set-open by id toggles one details", () => {
    const { doc, win } = loadBridge(QUIZ_BODY);
    const d2 = doc.getElementById("q2") as HTMLDetailsElement;
    expect(d2.open).toBe(false);
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "lh-quiz-set-open", id: "81-150", open: true },
      })
    );
    expect(d2.open).toBe(true);
    expect((doc.getElementById("q1") as HTMLDetailsElement).open).toBe(true);
  });

  it("toggle open edge posts lh-quiz-peeked once per id", () => {
    const { doc, win, messages } = loadBridge(QUIZ_BODY);
    const d2 = doc.getElementById("q2") as HTMLDetailsElement;
    messages.length = 0;
    d2.open = true;
    d2.dispatchEvent(new win.Event("toggle", { bubbles: true }));
    const peeked = messages.filter((m) => m.type === "lh-quiz-peeked");
    expect(peeked).toHaveLength(1);
    expect(peeked[0].id).toBe("81-150");
    messages.length = 0;
    d2.open = false;
    d2.dispatchEvent(new win.Event("toggle", { bubbles: true }));
    expect(messages.filter((m) => m.type === "lh-quiz-peeked")).toHaveLength(0);
    d2.open = true;
    d2.dispatchEvent(new win.Event("toggle", { bubbles: true }));
    // already peeked — no second emit
    expect(messages.filter((m) => m.type === "lh-quiz-peeked")).toHaveLength(0);
  });

  it("golden details-quiz.html: collapse-all leaves every details.open false", () => {
    // Fixture mirrors __golden__/html/details-quiz.html structure (2 details).
    const goldenBody = `
<details open><summary>题干：What is 2+2?</summary><div class="answer">答案：4</div></details>
<details><summary>题干：What is 3+3?</summary><div class="answer">答案：6</div></details>
<label class="stem">Label-wrapped stem should still locate</label>
`;
    const { doc, win } = loadBridge(goldenBody);
    const details = [...doc.querySelectorAll("details")] as HTMLDetailsElement[];
    expect(details).toHaveLength(2);
    expect(details.some((d) => d.open)).toBe(true);
    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { type: "lh-quiz-set-open", all: true, open: false },
      })
    );
    expect(details.every((d) => d.open === false)).toBe(true);
  });
});

/** Polyfill the caret API the bridge uses for word-level locate. */
function stubCaret(doc: Document, node: Node, offset: number) {
  Object.defineProperty(doc, "caretRangeFromPoint", {
    configurable: true,
    value: () => ({ startContainer: node, startOffset: offset }),
  });
}

describe("bridge jsdom: word-level payload (plainOffset)", () => {
  it("reports the caret offset inside the annotated element's rendered text", () => {
    const { messages, doc, win } = loadBridge(
      `<p data-lh="0-40" id="p1">alpha <em>beta</em> gamma</p>`
    );
    const gamma = doc.getElementById("p1")!.lastChild!;
    expect(gamma.nodeValue).toBe(" gamma");
    stubCaret(doc, gamma, 4); // after " gam"
    messages.length = 0;
    leftClick(win, doc.getElementById("p1")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    // "alpha " (6) + "beta" (4) + 4 → 14
    expect(locate[0].plainOffset).toBe(14);
  });

  it("skips script text so offsets stay aligned with the source map", () => {
    const { messages, doc, win } = loadBridge(
      `<div data-lh="0-80" id="d"><script>var hidden = 1;</script><p>real text</p></div>`
    );
    const text = doc.querySelector("p")!.firstChild!;
    stubCaret(doc, text, 5);
    messages.length = 0;
    leftClick(win, doc.getElementById("d")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0].plainOffset).toBe(5);
  });

  it("omits plainOffset when no caret API is available", () => {
    const { messages, doc, win } = loadBridge(`<p data-lh="0-20" id="p1">plain text</p>`);
    messages.length = 0;
    leftClick(win, doc.getElementById("p1")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0].plainOffset).toBeUndefined();
  });
});

describe("bridge jsdom: attribute fallback", () => {
  it("posts alt for a text-less img click", () => {
    const { messages, doc, win } = loadBridge(
      `<img data-lh="10-60" id="img1" src="x.png" alt="折线图">`
    );
    messages.length = 0;
    leftClick(win, doc.getElementById("img1")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0].text).toBe("");
    expect(locate[0].attrName).toBe("alt");
    expect(locate[0].attrValue).toBe("折线图");
    expect(locate[0].range).toEqual({ start: 10, end: 60 });
  });

  it("prefers aria-label over title", () => {
    const { messages, doc, win } = loadBridge(
      `<div data-lh="1-9" id="d" title="ttl"><span id="s" aria-label="图例"></span></div>`
    );
    messages.length = 0;
    leftClick(win, doc.getElementById("s")!);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);
    expect(locate[0].attrName).toBe("aria-label");
    expect(locate[0].attrValue).toBe("图例");
  });

  it("still ignores blank chrome with no text and no attribute", () => {
    const { messages, doc, win } = loadBridge(
      `<div data-lh="1-9" id="d"><span id="bare"></span></div>`
    );
    messages.length = 0;
    leftClick(win, doc.getElementById("bare")!);
    expect(onlyLocate(messages)).toEqual([]);
  });
});

describe("bridge jsdom: click → source word (end-to-end contract)", () => {
  /**
   * The riskiest part of word-level locate is that the bridge's caret offset and
   * `buildHtmlPlainMap` agree. This drives a real click through the generated
   * bridge and feeds its payload to the parent-side resolver.
   */
  it("resolves the clicked word, not the whole element", () => {
    const source = normalizeNewlines(
      `<h2 id="t">标题</h2><p>第一段 filler text, second word here.</p>`
    );
    const { messages, doc, win } = loadBridge(buildInstrumentedSrcDoc(source));
    const p = doc.querySelector("p")!;
    expect(p.getAttribute("data-lh")).toBeTruthy();
    const text = p.firstChild!;
    const caret = text.nodeValue!.indexOf("second") + 3; // inside "second"
    stubCaret(doc, text, caret);

    messages.length = 0;
    leftClick(win, p);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);

    const hit = locatePreviewClick({
      source,
      text: String(locate[0].text ?? ""),
      container: locate[0].range as { start: number; end: number },
      plainOffset: locate[0].plainOffset as number,
    });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("second");
  });

  it("resolves an img alt value when the element renders no text", () => {
    const source = normalizeNewlines(
      `<figure><img src="a.png" alt="折线图"><figcaption>图 1</figcaption></figure>`
    );
    const { messages, doc, win } = loadBridge(buildInstrumentedSrcDoc(source));
    const img = doc.querySelector("img")!;
    messages.length = 0;
    leftClick(win, img);
    const locate = onlyLocate(messages);
    expect(locate).toHaveLength(1);

    const hit = locatePreviewClick({
      source,
      text: String(locate[0].text ?? ""),
      container: locate[0].range as { start: number; end: number },
      attrName: locate[0].attrName as string,
      attrValue: locate[0].attrValue as string,
      tag: locate[0].tag as string,
    });
    expect(hit.precision).toBe("exact");
    expect(source.slice(hit.start, hit.end)).toBe("折线图");
  });
});

describe("CSS 命中采集（lh-css-query）", () => {
  const CSS = `:root { --ink: #333; }
body div { border: 1px solid #ccc; }
.card { padding: 16px; }
.card:hover { transform: translateY(-2px); }
@media (max-width: 520px) {
  .card { padding: 10px; }
}`;

  function loadWithCss(bodyHtml: string, css = CSS) {
    return loadBridge(
      `<style data-lh-inline="demo/css/style.css">${css}</style>${bodyHtml}`
    );
  }

  function askCss(win: JSDOM["window"], nonce = 1) {
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { type: "lh-css-query", nonce } })
    );
    return win;
  }

  it("点击后回传命中的规则（选择器 / 文件 / @ 条件）", () => {
    const { messages, doc, win } = loadWithCss(
      `<div class="card" id="c">卡片</div>`
    );
    const card = doc.querySelector("#c")!;
    leftClick(win, card);
    messages.length = 0;
    askCss(win, 7);

    const reply = messages.find((m) => m.type === "lh-css-hits");
    expect(reply).toBeTruthy();
    expect(reply!.nonce).toBe(7);
    expect(reply!.text).toBe("卡片");

    const hits = reply!.hits as Array<Record<string, unknown>>;
    expect(reply!.label).toBe("div#c.card");
    // `:hover` 在 jsdom 里随点击变成 true（真实浏览器同样：点的时候指针就在上面），
    // 所以这里 4 条 —— 正是验收里要的面板内容。
    // 同 specificity 时源码靠后的先列：@media 内 .card(3) > 顶层 .card(1)
    expect(hits.map((h) => h.selector)).toEqual([
      ".card:hover",
      ".card",
      ".card",
      "body div",
    ]);
    expect(hits.map((h) => h.file)).toEqual([
      "demo/css/style.css",
      "demo/css/style.css",
      "demo/css/style.css",
      "demo/css/style.css",
    ]);
    expect(hits[1].conditions).toEqual(["@media (max-width: 520px)"]);
    expect(hits[2].conditions).toEqual([]);
    expect(String(hits[1].cssText)).toContain("padding: 10px");
    // @ 条件是否当前成立：jsdom 没有 matchMedia，只能保证给的是布尔值（浏览器里宽屏为 false）
    expect(typeof hits[0].active).toBe("boolean");
    expect(typeof hits[1].active).toBe("boolean");
  });

  it("伪类按元素真实状态判定：:focus / 别的元素的 :hover 都不命中", () => {
    const css = `body div { border: 1px solid #ccc; }
.card { padding: 16px; }
.card:hover { color: red; }
.card:focus { color: blue; }
.other:hover { color: green; }`;
    const { messages, doc, win } = loadWithCss(
      `<div class="card" id="c">卡片</div><p class="other">别的</p>`,
      css
    );
    leftClick(win, doc.querySelector("#c")!);
    messages.length = 0;
    askCss(win, 1);
    const hits = messages.find((m) => m.type === "lh-css-hits")!.hits as Array<
      Record<string, unknown>
    >;
    const selectors = hits.map((h) => String(h.selector));
    expect(selectors).toContain(".card:hover");
    // 没聚焦 → :focus 不命中；没悬停别的元素 → .other:hover 不命中
    expect(selectors).not.toContain(".card:focus");
    expect(selectors).not.toContain(".other:hover");
    expect(selectors).not.toContain(".nope");
  });

  it("没有点击时返回空命中（不抛错）", () => {
    const { messages, win } = loadWithCss(`<div class="card">卡片</div>`);
    messages.length = 0;
    askCss(win, 3);
    const reply = messages.find((m) => m.type === "lh-css-hits");
    expect(reply!.nonce).toBe(3);
    expect(reply!.hits).toEqual([]);
    expect(reply!.label).toBe("");
  });

  it("未内联的样式表（无 data-lh-inline）file 为空串，交给父窗口判 fuzzy", () => {
    const { messages, doc, win } = loadBridge(
      `<style>.plain { color: red; }</style><div class="plain">x</div>`
    );
    leftClick(win, doc.querySelector(".plain")!);
    messages.length = 0;
    askCss(win, 1);
    const hits = messages.find((m) => m.type === "lh-css-hits")!.hits as Array<
      Record<string, unknown>
    >;
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("");
  });

  it("bridge 的 specificity 与 cssLocate.specificityOf 一致", () => {    const selectors = [
      "div",
      ".card",
      "#c",
      "div.card",
      "body div.card",
      "[data-x]",
      `div[data-x="1"]`,
      ":is(.card, #nope)",
      ":where(.card)",
      "body > div",
      ".card.card",
      "div:not(.zzz)",
      "section .card",
    ];
    const css = selectors.map((s) => `${s} { color: red; }`).join("\n");
    const { messages, doc, win } = loadWithCss(
      `<div class="card" id="c" data-x="1">卡片</div>`,
      css
    );
    leftClick(win, doc.querySelector("#c")!);
    messages.length = 0;
    askCss(win, 1);
    const hits = messages.find((m) => m.type === "lh-css-hits")!.hits as Array<
      Record<string, unknown>
    >;
    // `section .card` 不命中，其余都应命中
    expect(hits).toHaveLength(selectors.length - 1);
    for (const h of hits) {
      expect(h.specificity, String(h.selector)).toEqual(
        specificityOf(String(h.selector))
      );
    }
  });
});

describe("整条链路：demo 项目 srcDoc → 点卡片 → 4 条规则带行号", () => {
  function loadDoc(html: string) {
    const dom = new JSDOM(html, {
      url: "https://langhuan.test/preview",
      pretendToBeVisual: true,
      runScripts: "outside-only",
    });
    const win = dom.window;
    polyfillRange(win);
    const messages: Msg[] = [];
    Object.defineProperty(win, "parent", {
      configurable: true,
      value: {
        postMessage(data: unknown) {
          if (data && typeof data === "object") messages.push(data as Msg);
        },
      },
    });
    if (typeof win.requestAnimationFrame !== "function") {
      win.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        win.setTimeout(() => cb(performance.now()), 0)) as typeof win.requestAnimationFrame;
    }
    win.eval(bridgeBody());
    return { dom, win, doc: win.document, messages };
  }

  it("内联后的页面点卡片：命中 4 条，全部能落到 style.css 的对应行", async () => {
    const dir = "examples/项目示例";
    const libDir = "项目示例";
    const html = readFileSync(`${dir}/index.html`, "utf8");
    const css = readFileSync(`${dir}/css/style.css`, "utf8");
    const js = readFileSync(`${dir}/js/app.js`, "utf8");
    const file = "项目示例/css/style.css";

    const srcDoc = buildInstrumentedSrcDoc(html, undefined, {
      inline: (h) =>
        inlineProjectHtml(h, {
          baseDir: "",
          readFile: (rel) =>
            rel === "css/style.css" ? css : rel === "js/app.js" ? js : null,
          // 与 HtmlReader 一致：属性写库内路径，索引才认得
          mapPath: (rel) => `${libDir}/${rel}`,
        }).html,
    });
    // 内联真的发生了：外链标签没了、正文进了 <style>
    expect(srcDoc).not.toContain('href="css/style.css"');
    expect(srcDoc).toContain('data-lh-inline="项目示例/css/style.css"');
    expect(srcDoc).toContain("--accent:");

    const { messages, doc, win } = loadDoc(srcDoc);
    const card = doc.querySelector("#demo-card")!;
    expect(card).toBeTruthy();
    leftClick(win, card);
    messages.length = 0;
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { type: "lh-css-query", nonce: 11 } })
    );

    const reply = messages.find((m) => m.type === "lh-css-hits")!;
    expect(reply.nonce).toBe(11);
    expect(reply.label).toBe("div#demo-card.card");

    const index = await buildCssIndex(file, css);
    const resolved = resolveCssHits(reply.hits as RawCssHit[], [index]);
    expect(resolved).toHaveLength(4);
    expect(resolved.map((h) => h.selector).sort()).toEqual(
      [".card", ".card", ".card:hover", "body div"].sort()
    );
    expect(resolved.every((h) => h.precision === "exact")).toBe(true);
    expect(resolved.every((h) => h.file === file)).toBe(true);

    const lines = css.split(/\r?\n/);
    for (const h of resolved) {
      expect(h.file).toBe(file);
      expect(lines[h.startLine - 1]).toContain(h.selector);
      expect(lines[h.endLine - 1]).toContain("}");
    }
    // 两条 .card 分别落在顶层与 @media 内
    const cards = resolved.filter((h) => h.selector === ".card");
    expect(cards).toHaveLength(2);
    expect(cards.some((h) => h.atRules.length === 0)).toBe(true);
    expect(cards.some((h) => h.atRules[0]?.startsWith("@media"))).toBe(true);
    expect(cards[0].startLine).not.toBe(cards[1].startLine);
  });

  it("行为面板要的元素身份 + 祖先链：回传的是真实点击目标，不是 CSS 向上找到的容器", () => {
    const html = `<!DOCTYPE html><html><body><ul id="list" class="todos"><li class="row" id="row-1"><button id="btn" class="primary">保存</button></li></ul></body></html>`;
    const { messages, doc, win } = loadDoc(buildInstrumentedSrcDoc(html));
    const btn = doc.querySelector("#btn")!;
    leftClick(win, btn);
    messages.length = 0;
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { type: "lh-css-query", nonce: 3 } })
    );

    const reply = messages.find((m) => m.type === "lh-css-hits")!;
    expect(reply.nonce).toBe(3);
    expect(reply.element).toMatchObject({ tag: "button", id: "btn", classes: ["primary"] });
    expect(reply.label).toBe("button#btn.primary");

    const ancestors = reply.ancestors as Array<{
      tag: string;
      id?: string;
      classes?: string[];
    }>;
    expect(ancestors.map((a) => a.tag)).toEqual(["li", "ul", "body"]);
    expect(ancestors[0].id).toBe("row-1");
    expect(ancestors[1]).toMatchObject({ tag: "ul", id: "list", classes: ["todos"] });
    // html 不进链（它永远是 html，没有分辨价值）
    expect(ancestors.some((a) => a.tag === "html")).toBe(false);
  });
});
