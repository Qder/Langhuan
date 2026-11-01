/**
 * 验收示例（examples/行为定位验收）的自动化核对。
 *
 * 走真实链路：内联 + 插桩 → jsdom 里点元素 → bridge 回传 element/ancestors →
 * acorn 静态索引反查行号。示例或 README 里那张表改了，这里会一起红。
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { buildInstrumentedSrcDoc } from "./bridge";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";
import { inlineProjectHtml } from "../inlineProject";
import { buildElementHtmlInfo, formatOpenTag } from "./elementInspect";
import {
  buildInlineScriptIndexes,
  buildJsIndex,
  NO_DIRECT_BINDING_HINT,
  resolveBehaviorHits,
  type ElementNode,
} from "./jsIndex";

const DIR = "examples/行为定位验收";
const LIB = "行为定位验收";
const APP = `${LIB}/js/app.js`;
const HTML_FILE = `${LIB}/index.html`;

// 与应用一致：库内文件读出来先统一成 LF（contentFs / buildInstrumentedSrcDoc 都这么做），
// 否则 git 在 Windows 上检出的 CRLF 会让 data-lh 的偏移和原文件对不上。
const read = (rel: string) => readFileSync(`${DIR}/${rel}`, "utf8").replace(/\r\n/g, "\n");

type Msg = Record<string, unknown>;

function bridgeBody(): string {
  const m = HTML_LOCATE_BRIDGE.match(/<script[^>]*>([\s\S]*)<\/script>/i);
  if (!m) throw new Error("HTML_LOCATE_BRIDGE missing script");
  return m[1];
}

function loadDemo() {
  const html = read("index.html");
  const srcDoc = buildInstrumentedSrcDoc(html, undefined, {
    inline: (h) =>
      inlineProjectHtml(h, {
        baseDir: "",
        readFile: (rel) => {
          try {
            return read(rel);
          } catch {
            return null;
          }
        },
        // 与 HtmlReader 一致：属性写库内路径
        mapPath: (rel) => `${LIB}/${rel}`,
      }).html,
  });

  const dom = new JSDOM(srcDoc, {
    url: "https://langhuan.test/preview",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const win = dom.window;
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
  return { srcDoc, dom, win, doc: win.document, messages };
}

function click(win: JSDOM["window"], el: Element) {
  const opts = { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 };
  el.dispatchEvent(new win.MouseEvent("mousedown", opts));
  el.dispatchEvent(new win.MouseEvent("click", { ...opts, detail: 1 }));
}

async function demoIndexes() {
  const app = await buildJsIndex(APP, read("js/app.js"));
  const inline = await buildInlineScriptIndexes(HTML_FILE, read("index.html"));
  return [app, ...inline];
}

async function probe(selector: string) {
  const indexes = await demoIndexes();
  const { win, doc, messages } = loadDemo();
  const el = doc.querySelector(selector);
  if (!el) throw new Error(`示例里没有 ${selector}`);
  click(win, el);
  // 点击那一刻的 lh-element 才是这次点击的身份（后面清空是为了只看 css 回复）
  const probe = messages.find((m) => m.type === "lh-element");
  messages.length = 0;
  win.dispatchEvent(
    new win.MessageEvent("message", { data: { type: "lh-css-query", nonce: 7 } })
  );
  const reply = messages.find((m) => m.type === "lh-css-hits");
  if (!reply) throw new Error("bridge 没回 lh-css-hits");
  expect(reply.nonce).toBe(7);
  const element = reply.element as ElementNode;
  const ancestors = Array.isArray(reply.ancestors) ? (reply.ancestors as ElementNode[]) : [];
  const resolved = resolveBehaviorHits({ ...element, ancestors }, indexes);
  return { reply, probe, element, resolved };
}

describe("验收示例：examples/行为定位验收", () => {
  it("内联与插桩到位：app.js 进了页面，内联 <script> 还在", () => {
    const { srcDoc, doc } = loadDemo();
    expect(srcDoc).toContain(`data-lh-inline="${APP}"`);
    // 用户自己写的内联脚本没被内联流程吃掉
    expect(srcDoc).toContain("onNoteClick");
    expect(doc.getElementById("btn")).toBeTruthy();
    expect(doc.querySelectorAll("#todo-list li")).toHaveLength(2);
  });

  it("点 #btn → click / onSaveClick / app.js:12，高亮整个函数 8–10", async () => {
    const { element, resolved } = await probe("#btn");
    expect(element).toMatchObject({ tag: "button", id: "btn" });

    expect(resolved.hits).toHaveLength(1);
    const hit = resolved.hits[0];
    expect(hit).toMatchObject({
      file: APP,
      startLine: 12,
      highlightStart: 8,
      highlightEnd: 10,
      event: "click",
      handlerName: "onSaveClick",
      match: "self",
      precision: "exact",
    });
    // 面板上显示的就是 README 承诺的那一行
    expect(`${hit.file}:${hit.startLine}`).toBe(`${APP}:12`);

    const lines = read("js/app.js").split(/\r?\n/);
    expect(lines[hit.startLine - 1]).toContain('.addEventListener("click"');
    expect(lines[hit.highlightStart - 1]).toContain("function onSaveClick");
    expect(lines[hit.highlightEnd - 1]).toBe("}");
    expect(resolved.hint).toBe("");
  });

  it("点 <li> → 落到父元素 #todo-list 上（委托），并说明是父元素", async () => {
    const { resolved } = await probe("#todo-list li");
    expect(resolved.hits).toHaveLength(1);
    const hit = resolved.hits[0];
    expect(hit).toMatchObject({
      file: APP,
      event: "click",
      selector: "#todo-list",
      handlerName: "onTodoClick",
      match: "ancestor",
      precision: "fuzzy",
    });
    expect(hit.note).toContain("#todo-list");
    expect(hit.note).toContain("委托");
  });

  it("点 #reset → 变量间接绑定也能回到原作者函数", async () => {
    const { resolved } = await probe("#reset");
    expect(resolved.hits).toHaveLength(1);
    expect(resolved.hits[0]).toMatchObject({
      event: "click",
      selector: "#reset",
      handlerName: "onReset",
      match: "self",
      precision: "exact",
    });
    const lines = read("js/app.js").split(/\r?\n/);
    expect(lines[resolved.hits[0].startLine - 1]).toContain("reset.addEventListener");
  });

  it("点内联脚本绑定的元素 → 行号指向 HTML 本身", async () => {
    const { resolved } = await probe("#inline-note");
    expect(resolved.hits).toHaveLength(1);
    const hit = resolved.hits[0];
    expect(hit).toMatchObject({ file: HTML_FILE, event: "click", handlerName: "onNoteClick", inline: true });
    const lines = read("index.html").split(/\r?\n/);
    expect(lines[hit.startLine - 1]).toContain('getElementById("inline-note")');
  });

  it("点没有绑定也没有查询的灰区 → 如实说「未找到」，并把页面级监听单列", async () => {
    const { resolved } = await probe("#plain");
    expect(resolved.hits).toHaveLength(0);
    expect(resolved.hint).toBe(NO_DIRECT_BINDING_HINT);
    // document 上的 keydown 仍在：它可能是这个元素的委托
    expect(resolved.delegated.map((h) => h.event)).toContain("keydown");
    // bindHover(el) 里的绑定归属不到，别硬算成命中
    expect(resolved.unresolved).toBe(1);
  });

  it("app.js 里第 12 行就是那行 addEventListener（改示例前先过这里）", () => {
    const lines = read("js/app.js").split(/\r?\n/);
    expect(lines[11]).toBe(
      'document.getElementById("btn").addEventListener("click", onSaveClick);'
    );
  });

  it("抽屉第一段（HTML）：点 button 也算得出精确行号（靠 data-lh 标注）", async () => {
    const { probe: probeMsg, element } = await probe("#btn");
    const range = (probeMsg?.range ?? null) as { start: number; end: number } | null;
    expect(range).toBeTruthy();

    const source = read("index.html");
    const info = buildElementHtmlInfo({ file: HTML_FILE, source, element, range })!;
    expect(info.precision).toBe("exact");
    const lines = source.split(/\r?\n/);
    expect(lines[info.startLine - 1]).toContain('<button id="btn"');
    expect(info.tag).toBe("button");
    expect(info.attrs.some((a) => a.name === "id" && a.value === "btn")).toBe(true);
    // data-lh 是插桩属性，不该出现在面板的「打开标签」里
    expect(info.attrs.some((a) => a.name === "data-lh")).toBe(false);
    expect(formatOpenTag(info.tag, info.attrs)).toContain('id="btn"');
  });
});
