/**
 * 逗号列表 + 同名规则重复：真实 srcDoc → bridge 点击 → resolveCssHits 的端到端核对。
 *
 * 这里不手工拼 RawCssHit，全部走真链路：inlineProjectHtml 内联 CSS → 插桩 → jsdom 里跑
 * bridge → 点击元素 → 父窗口拿回 lh-css-hits → 用 postcss 索引解析行号。
 * 所以「命中的是哪一支」「同条件第几条」都是浏览器那一套 CSSOM + el.matches 真算出来的，
 * 不是测试里假设的。
 */
import { describe, expect, it, onTestFinished } from "vitest";
import { JSDOM } from "jsdom";
import { buildInstrumentedSrcDoc } from "./bridge";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";
import {
  buildCssIndex,
  resolveCssHits,
  type RawCssHit,
  type ResolvedCssHit,
} from "./cssLocate";
import { inlineProjectHtml } from "../inlineProject";

const LIB = "逗号选择器验收";
const CSS_FILE = `${LIB}/css/site.css`;

/**
 * 行号必须和 index 对得上，别随便插入空行：
 *  1 .card            ← 同条件下第一条
 *  2 .card            ← 同条件下第二条（旧实现两条命中都会跳到这里之上的第 1 行）
 *  3 (空)
 *  4 @media …
 *  5   .card          ← 条件不同 → 另一套 occurrence
 *  6 }
 *  7 (空)
 *  8 #hero, .card     ← 只命中 .card 时要按 (0,1,0) 算
 *  9 div, .card       ← 多支同时命中 → 取命中分支里最高的
 * 10 :is(#hero, .card), .card-x  ← :is 参数仍按规范取最大值
 * 11 :where(.card), .card-x      ← :where 恒为 0
 */
const CSS = `.card { color: red; }
.card { color: blue; }

@media (max-width: 520px) {
  .card { color: green; }
}

#hero, .card { border: 1px solid #333; }
div, .card { outline: 1px dotted #999; }
:is(#hero, .card), .card-x { margin: 0; }
:where(.card), .card-x { padding: 0; }
`;

const HTML = `<!doctype html>
<html><head><link rel="stylesheet" href="css/site.css"></head>
<body>
  <div id="hero" class="card">hero</div>
  <p id="only-card" class="card">只有 card 类</p>
  <div id="plain" class="card card-x">card + card-x</div>
</body></html>`;

type Msg = Record<string, unknown>;

function bridgeBody(): string {
  const m = HTML_LOCATE_BRIDGE.match(/<script[^>]*>([\s\S]*)<\/script>/i);
  if (!m) throw new Error("HTML_LOCATE_BRIDGE missing script");
  return m[1];
}

/** 内联 + 插桩 + 在 jsdom 里跑 bridge，返回一个「点谁问谁」的小工具。 */
async function setup() {
  const srcDoc = buildInstrumentedSrcDoc(HTML, undefined, {
    inline: (h) =>
      inlineProjectHtml(h, {
        baseDir: "",
        readFile: (rel) => (rel === "css/site.css" ? CSS : null),
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
  // pretendToBeVisual 会开着 rAF 定时器：测试结束就关窗，别让它在整轮里空转
  onTestFinished(() => {
    try {
      win.close();
    } catch {
      /* 已经关了 */
    }
  });

  const index = await buildCssIndex(CSS_FILE, CSS);

  const click = (el: Element) => {
    const opts = { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 };
    el.dispatchEvent(new win.MouseEvent("mousedown", opts));
    el.dispatchEvent(new win.MouseEvent("click", { ...opts, detail: 1 }));
  };

  /** 点击 → 追问样式 → 原始命中（未经父窗口解析）。 */
  const rawHitsOf = (selector: string): RawCssHit[] => {
    const el = win.document.querySelector(selector);
    if (!el) throw new Error(`找不到元素 ${selector}`);
    click(el);
    messages.length = 0;
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { type: "lh-css-query", nonce: 1 } })
    );
    const reply = messages.find((m) => m.type === "lh-css-hits");
    if (!reply) throw new Error("没有收到 lh-css-hits");
    return reply.hits as RawCssHit[];
  };

  const hitsOf = (selector: string): ResolvedCssHit[] =>
    resolveCssHits(rawHitsOf(selector), [index]);

  return { srcDoc, win, index, rawHitsOf, hitsOf };
}

/** 按选择器文本取命中（同名规则会有多条，这里只要第一条用于断言特异性）。 */
function bySelector(hits: ResolvedCssHit[], selector: string): ResolvedCssHit[] {
  return hits.filter((h) => h.selector === selector);
}

function lineOf(css: string, needle: string): number {
  const i = css.split(/\r?\n/).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`CSS 里找不到 ${needle}`);
  return i + 1;
}

describe("端到端：同名规则重复出现", () => {
  it("同一文件里 .card 写了两遍：两条命中分别落到第 1 / 2 行（不再都跳第一条）", async () => {
    const { hitsOf } = await setup();
    const cards = hitsOf("#only-card").filter((h) => h.selector === ".card" && h.atRules.length === 0);
    expect(cards).toHaveLength(2);
    const lines = cards.map((h) => h.startLine).sort((a, b) => a - b);
    expect(lines).toEqual([1, 2]);
    expect(cards.every((h) => h.precision === "exact")).toBe(true);
    expect(cards.every((h) => h.file === CSS_FILE)).toBe(true);
    // 两条规则的内容不一样：第 1 行 red、第 2 行 blue
    const red = cards.find((h) => h.startLine === 1)!;
    const blue = cards.find((h) => h.startLine === 2)!;
    expect(red.decls.join("; ")).toContain("color: red");
    expect(blue.decls.join("; ")).toContain("color: blue");
  });

  it("同选择器分别位于 @media 内外：各按各的条件定位，@media 内那条标出条件", async () => {
    const { hitsOf } = await setup();
    const cards = hitsOf("#only-card").filter((h) => h.selector === ".card");
    expect(cards).toHaveLength(3);

    const mediaLine = lineOf(CSS, "@media");
    const inMedia = cards.filter((h) => h.atRules.length > 0);
    expect(inMedia).toHaveLength(1);
    expect(inMedia[0].startLine).toBe(mediaLine + 1);
    expect(inMedia[0].atRules[0]).toMatch(/^@media/);
    expect(inMedia[0].precision).toBe("exact");

    const outside = cards.filter((h) => h.atRules.length === 0).map((h) => h.startLine);
    expect(outside.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("没有 occurrence 的老 bridge（把字段抹掉）→ fuzzy 且不给行号，而不是错跳第一条", async () => {
    const { rawHitsOf, index } = await setup();
    const legacy = rawHitsOf("#only-card").map(({ occurrence, ...rest }) => {
      void occurrence;
      return rest;
    });
    const resolved = resolveCssHits(legacy, [index]);
    const cards = resolved.filter((h) => h.selector === ".card" && h.atRules.length === 0);
    expect(cards).toHaveLength(2);
    for (const h of cards) {
      expect(h.precision).toBe("fuzzy");
      expect(h.startLine).toBe(0);
      expect(h.message).toContain("存在多条同名规则");
      expect(h.message).toContain("无法唯一对应");
    }
  });

  it("唯一候选的规则不受影响：body 级规则照旧 exact", async () => {
    const { hitsOf } = await setup();
    const card = hitsOf("#only-card").find((h) => h.selector === ".card")!;
    expect(card.precision).toBe("exact");
    expect(card.startLine).toBeGreaterThan(0);
  });
});

describe("端到端：逗号选择器列表按命中分支算特异性", () => {
  it("#hero, .card 命中只有 .card 的元素 → (0,1,0)，并标明命中的是 .card", async () => {
    const { hitsOf } = await setup();
    const hit = bySelector(hitsOf("#only-card"), "#hero, .card")[0];
    expect(hit).toBeTruthy();
    expect(hit.specificity).toEqual([0, 1, 0]);
    expect(hit.matchedBranches).toEqual([".card"]);
    // 展示仍用完整选择器
    expect(hit.selector).toBe("#hero, .card");
    expect(hit.startLine).toBe(lineOf(CSS, "#hero, .card"));
    expect(hit.precision).toBe("exact");
  });

  it("同一个元素两支都命中（#hero + .card）→ 取命中分支里最高的 (1,0,0)，不标分支", async () => {
    const { hitsOf } = await setup();
    const hit = bySelector(hitsOf("#hero"), "#hero, .card")[0];
    expect(hit.specificity).toEqual([1, 0, 0]);
    expect(hit.matchedBranches).toBeUndefined();
  });

  it("div, .card 在 <div class=card> 上两支都命中 → (0,1,0)；在 <p class=card> 上只命中 .card，也是 (0,1,0)", async () => {
    const { hitsOf } = await setup();
    const onDiv = bySelector(hitsOf("#hero"), "div, .card")[0];
    expect(onDiv.specificity).toEqual([0, 1, 0]);
    expect(onDiv.matchedBranches).toBeUndefined();

    const onP = bySelector(hitsOf("#only-card"), "div, .card")[0];
    expect(onP.specificity).toEqual([0, 1, 0]);
    expect(onP.matchedBranches).toEqual([".card"]);
  });

  it(":is() 与逗号列表组合：顶层只命中 :is 那一支，:is 的参数仍按规范取最大值", async () => {
    const { hitsOf } = await setup();
    // #only-card：:is(#hero, .card) 命中（.card 支），.card-x 不命中
    const hit = bySelector(hitsOf("#only-card"), ":is(#hero, .card), .card-x")[0];
    expect(hit.matchedBranches).toEqual([":is(#hero, .card)"]);
    // :is() 的特异性 = 参数里最大的 #hero → (1,0,0)（不看命中的是 .card 支）
    expect(hit.specificity).toEqual([1, 0, 0]);
  });

  it(":where() 与逗号列表组合：命中 :where 那一支时特异性是 (0,0,0)", async () => {
    const { hitsOf } = await setup();
    const hit = bySelector(hitsOf("#only-card"), ":where(.card), .card-x")[0];
    expect(hit.matchedBranches).toEqual([":where(.card)"]);
    expect(hit.specificity).toEqual([0, 0, 0]);
  });

  it("排序跟着命中分支走：:is(…) 的 (1,0,0) 压过 .card 的 (0,1,0)，:where(…) 的 (0,0,0) 垫底", async () => {
    const { hitsOf } = await setup();
    const hits = hitsOf("#only-card");
    const specOf = (sel: string) => bySelector(hits, sel)[0].specificity;

    const order = hits.map((h) => h.selector);
    // 选择器文本可能重复（.card 两条），用「第一次出现」判断相对位置
    const first = (sel: string) => order.indexOf(sel);
    expect(first(":is(#hero, .card), .card-x")).toBeLessThan(
      first("#hero, .card")
    );
    expect(first("#hero, .card")).toBeLessThan(first(":where(.card), .card-x"));
    expect(specOf(":where(.card), .card-x")).toEqual([0, 0, 0]);
    // 降序：整个列表按特异性单调不增
    for (let i = 1; i < hits.length; i++) {
      const a = hits[i - 1].specificity;
      const b = hits[i].specificity;
      expect(a[0] * 10000 + a[1] * 100 + a[2]).toBeGreaterThanOrEqual(
        b[0] * 10000 + b[1] * 100 + b[2]
      );
    }
  });

  it("bridge 真的回了 occurrence / matchedBranches（协议字段不是摆设）", async () => {
    const { rawHitsOf } = await setup();
    const raw = rawHitsOf("#only-card");
    const cards = raw.filter((h) => h.selector === ".card" && (h.conditions ?? []).length === 0);
    expect(cards.map((h) => h.occurrence).sort()).toEqual([0, 1]);
    const list = raw.find((h) => h.selector === "#hero, .card")!;
    expect(list.matchedBranches).toEqual([".card"]);
    expect(list.specificity).toEqual([0, 1, 0]);
  });
});
