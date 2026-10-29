/**
 * Loads the generated locate bridge IIFE into an isolated JSDOM and asserts
 * postMessage payloads with strict shape checks.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";

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
