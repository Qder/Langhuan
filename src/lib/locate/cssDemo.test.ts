/**
 * 验收示例（examples/样式定位验收）的自动化核对。
 *
 * 走的是真实链路：内联 + 插桩 → jsdom 里执行 bridge 与 app.js → 逐个元素点击 →
 * bridge 回传命中 → postcss 索引解析行号。示例改了这里会一起红，
 * 保证 README 里那张「点哪里 / 预期几条」的表不会悄悄过期。
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { buildInstrumentedSrcDoc } from "./bridge";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";
import {
  buildCssIndex,
  resolveCssHits,
  specificityOf,
  type RawCssHit,
  type ResolvedCssHit,
} from "./cssLocate";
import { inlineProjectHtml } from "../inlineProject";

const DIR = "examples/样式定位验收";
const LIB = "样式定位验收";
const BASE = `${LIB}/css/base.css`;
const EXTRA = `${LIB}/css/extra.css`;

const read = (rel: string) => readFileSync(`${DIR}/${rel}`, "utf8");

type Msg = Record<string, unknown>;

function bridgeBody(): string {
  const m = HTML_LOCATE_BRIDGE.match(/<script[^>]*>([\s\S]*)<\/script>/i);
  if (!m) throw new Error("HTML_LOCATE_BRIDGE missing script");
  return m[1];
}

function loadDemo() {
  const html = read("index.html");
  const js = read("js/app.js");
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
  // 页面自己的脚本（注入 <style>）也真跑一遍
  win.eval(js);
  return { srcDoc, dom, win, doc: win.document, messages };
}

function click(win: JSDOM["window"], el: Element) {
  const opts = { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 };
  el.dispatchEvent(new win.MouseEvent("mousedown", opts));
  el.dispatchEvent(new win.MouseEvent("click", { ...opts, detail: 1 }));
}

function askCss(win: JSDOM["window"], nonce: number) {
  win.dispatchEvent(
    new win.MessageEvent("message", { data: { type: "lh-css-query", nonce } })
  );
}

/** 紧凑签名：选择器 | 文件名 | exact/fuzzy | 条件链 */
function sig(h: ResolvedCssHit): string {
  const file = h.file ? h.file.split("/").pop() : "—";
  return `${h.selector}|${file}|${h.precision}|${h.atRules.join("+") || "-"}`;
}

describe("验收示例：examples/样式定位验收", () => {
  it("内联与注入都到位（否则下面的断言没有意义）", () => {
    const { srcDoc, doc } = loadDemo();
    expect(srcDoc).toContain(`data-lh-inline="${BASE}"`);
    expect(srcDoc).toContain(`data-lh-inline="${EXTRA}"`);
    expect(srcDoc).toContain(`data-lh-inline="${LIB}/js/app.js"`);
    // app.js 真把动态样式插进来了
    const dyn = doc.getElementById("dyn-style");
    expect(dyn).toBeTruthy();
    expect(dyn!.textContent).toContain(".injected");
  });

  it("每个方块的点数与面板内容都与 README 一致", async () => {
    const { win, doc, messages } = loadDemo();
    const indexes = [
      await buildCssIndex(BASE, read("css/base.css")),
      await buildCssIndex(EXTRA, read("css/extra.css")),
    ];
    const sourceLines = {
      [BASE]: read("css/base.css").split(/\r?\n/),
      [EXTRA]: read("css/extra.css").split(/\r?\n/),
    };

    const cases: Array<{ name: string; sel: string; expect: string[] }> = [
      {
        name: "① 卡片",
        sel: "#card",
        expect: [
          ".card:hover|base.css|exact|-",
          ".card|base.css|exact|@media (max-width: 520px)",
          ".card|base.css|exact|-",
          "body div|base.css|exact|-",
        ],
      },
      {
        name: "② 特异性",
        sel: "#alpha",
        expect: [
          "#alpha|base.css|exact|-",
          ".alpha|base.css|exact|-",
          "body div|base.css|exact|-",
        ],
      },
      {
        name: "③ 属性选择器",
        sel: '[data-kind="tip"]',
        expect: ['[data-kind="tip"]|base.css|exact|-', "body div|base.css|exact|-"],
      },
      {
        name: "④ :is()",
        sel: ".is-ok",
        expect: [":is(.is-ok, .nope)|base.css|exact|-", "body div|base.css|exact|-"],
      },
      {
        name: "④ :where()",
        sel: ".where-ok",
        // :where() 特异性恒为 0 → 排在 body div (0,0,2) 之后
        expect: ["body div|base.css|exact|-", ":where(.where-ok)|base.css|exact|-"],
      },
      {
        name: "⑤ :not() 命中",
        sel: ".chip:not(.off)",
        expect: [".chip:not(.off)|base.css|exact|-", "body div|base.css|exact|-"],
      },
      {
        name: "⑤ :not() 不命中（.chip.off）",
        sel: ".chip.off",
        expect: ["body div|base.css|exact|-"],
      },
      {
        name: "⑥ @supports 套 @media",
        sel: ".grid-chip",
        expect: [
          ".grid-chip|base.css|exact|@supports (display: grid)+@media (max-width: 520px)",
          ".grid-chip|base.css|exact|@supports (display: grid)",
          "body div|base.css|exact|-",
        ],
      },
      {
        name: "⑦ 两个文件同名规则",
        sel: ".shared",
        expect: [
          ".shared|extra.css|exact|-",
          ".shared|base.css|exact|-",
          "body div|base.css|exact|-",
        ],
      },
      {
        name: "⑧ HTML 内联 <style>",
        sel: ".inline-styled",
        expect: [".inline-styled|—|fuzzy|-", "body div|base.css|exact|-"],
      },
      {
        name: "⑧ 运行时注入",
        sel: ".injected",
        expect: [".injected|—|fuzzy|-", "body div|base.css|exact|-"],
      },
      {
        name: "⑩ 只在 extra.css",
        sel: ".only-extra",
        expect: [".only-extra|extra.css|exact|-", "body div|base.css|exact|-"],
      },
      { name: "⑨ 无规则区块", sel: "section.plain", expect: [] },
    ];

    const problems: string[] = [];

    for (const c of cases) {
      const el = doc.querySelector(c.sel);
      expect(el, c.name).toBeTruthy();
      click(win, el!);
      messages.length = 0;
      askCss(win, 1);
      const reply = messages.find((m) => m.type === "lh-css-hits");
      expect(reply, `${c.name} 应回传 lh-css-hits`).toBeTruthy();
      const resolved = resolveCssHits(reply!.hits as RawCssHit[], indexes);

      const actual = resolved.map(sig);
      if (JSON.stringify(actual) !== JSON.stringify(c.expect)) {
        problems.push(
          `${c.name}\n    实际: ${JSON.stringify(actual)}\n    预期: ${JSON.stringify(c.expect)}`
        );
      }

      // 精确命中的，行号必须指到真正的规则行，且末行收在 }
      for (const h of resolved) {
        if (h.precision !== "exact" || !h.file) continue;
        const lines = sourceLines[h.file as keyof typeof sourceLines];
        expect(lines[h.startLine - 1], `${c.name} ${h.selector} 起始行`).toContain(
          h.selector.split(",")[0]
        );
        expect(lines[h.endLine - 1], `${c.name} ${h.selector} 结束行`).toContain("}");
        expect(h.endLine).toBeGreaterThanOrEqual(h.startLine);
      }
    }

    // 一次性报出所有对不上的方块，而不是停在第一个人
    expect(problems.join("\n\n")).toBe("");
  });

  it("②的特异性顺序、④的 :where 记 0，与 cssLocate 的算法一致", () => {
    expect(specificityOf("#alpha")).toEqual([1, 0, 0]);
    expect(specificityOf(".alpha")).toEqual([0, 1, 0]);
    expect(specificityOf("body div")).toEqual([0, 0, 2]);
    expect(specificityOf(":is(.is-ok, .nope)")).toEqual([0, 1, 0]);
    expect(specificityOf(":where(.where-ok)")).toEqual([0, 0, 0]);
    expect(specificityOf(".chip:not(.off)")).toEqual([0, 2, 0]);
    expect(specificityOf(".card:hover")).toEqual([0, 2, 0]);
  });

  it("⑧：点「注入」按钮后，会多出一条「推断」规则", async () => {
    const { win, doc, messages } = loadDemo();
    const indexes = [
      await buildCssIndex(BASE, read("css/base.css")),
      await buildCssIndex(EXTRA, read("css/extra.css")),
    ];
    doc.getElementById("inject-more")!.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })
    );
    expect(doc.getElementById("live-count")!.textContent).toBe("1");

    click(win, doc.getElementById("injected")!);
    messages.length = 0;
    askCss(win, 3);
    const resolved = resolveCssHits(
      messages.find((m) => m.type === "lh-css-hits")!.hits as RawCssHit[],
      indexes
    );
    expect(resolved.map(sig)).toEqual([
      ".injected-live-1|—|fuzzy|-",
      ".injected|—|fuzzy|-",
      "body div|base.css|exact|-",
    ]);
  });

  it("⑨ 交互元素（链接）根本不问样式，面板不该被顶出来", () => {
    const { win, doc, messages } = loadDemo();
    click(win, doc.querySelector("a[href='#']")!);
    // 交互元素走自己的分支：不发 lh-locate，于是父窗口也不会发 lh-css-query
    expect(messages.filter((m) => m.type === "lh-locate")).toHaveLength(0);
  });

  it("点卡片里的粗体字会向上找到卡片（4 条，标签是 div#card.card）", async () => {
    const { win, doc, messages } = loadDemo();
    const indexes = [await buildCssIndex(BASE, read("css/base.css"))];
    click(win, doc.querySelector("#card strong")!);
    messages.length = 0;
    askCss(win, 9);
    const reply = messages.find((m) => m.type === "lh-css-hits")!;
    expect(reply.label).toBe("div#card.card");
    const resolved = resolveCssHits(reply.hits as RawCssHit[], indexes);
    expect(resolved).toHaveLength(4);
  });
});
