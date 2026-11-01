// @vitest-environment jsdom
/**
 * 抽屉的静态结构 / 无障碍断言（不挂 CodeMirror，源码视图要点击后才出现）。
 * 交互路径（键盘、pin、跳转）由人工在浏览器里核对，这里守住结构与文案。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementInspector } from "./ElementInspector";
import { NO_DIRECT_BINDING_HINT, type BehaviorHit } from "@/lib/locate/jsIndex";
import type { ResolvedCssHit } from "@/lib/locate/cssLocate";
import type { ElementPanelState } from "@/lib/store/slices/elementInspectSlice";

function cssHit(over: Partial<ResolvedCssHit> = {}): ResolvedCssHit {
  return {
    selector: ".card",
    file: "示例/style.css",
    startLine: 12,
    endLine: 14,
    specificity: [0, 1, 0],
    order: 1,
    atRules: [],
    active: true,
    decls: ["padding: 16px", "border-radius: 8px"],
    precision: "exact",
    message: "",
    ...over,
  };
}

function behaviorHit(over: Partial<BehaviorHit> = {}): BehaviorHit {
  return {
    file: "示例/js/app.js",
    startLine: 12,
    highlightStart: 8,
    highlightEnd: 10,
    selector: "#btn",
    event: "click",
    handlerName: "onSaveClick",
    match: "self",
    precision: "exact",
    inline: false,
    ...over,
  };
}

function panel(over: Partial<ElementPanelState> = {}): ElementPanelState {
  return {
    nonce: 3,
    label: "button#btn.primary",
    text: "保存",
    target: { tag: "button", id: "btn", classes: ["primary"] },
    html: {
      file: "示例/index.html",
      startLine: 24,
      endLine: 24,
      precision: "exact",
      note: "按元素标注（data-lh）定位到元素源码",
      tag: "button",
      attrs: [
        { name: "id", value: "btn" },
        { name: "class", value: "primary" },
      ],
    },
    css: [cssHit(), cssHit({ selector: "#btn", order: 2, specificity: [1, 0, 0] })],
    behavior: {
      hits: [behaviorHit()],
      delegated: [],
      queries: [],
      unresolved: 0,
      problems: [],
      hint: NO_DIRECT_BINDING_HINT,
    },
    ...over,
  };
}

const render = (p: ElementPanelState, pinned = false) =>
  renderToStaticMarkup(
    <ElementInspector panel={p} pinned={pinned} onClose={() => {}} onTogglePin={() => {}} />
  );

describe("ElementInspector 结构", () => {
  it("是一个有名字的 dialog（role + aria-labelledby/describedby）", () => {
    const html = render(panel());
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain("元素检视");
  });

  it("三段一次全给：HTML / 样式 / 行为，顺序固定且默认展开", () => {
    const html = render(panel());
    const htmlAt = html.indexOf(">HTML<");
    const styleAt = html.indexOf(">样式<");
    const behaviorAt = html.indexOf(">行为<");
    expect(htmlAt).toBeGreaterThan(-1);
    expect(styleAt).toBeGreaterThan(htmlAt);
    expect(behaviorAt).toBeGreaterThan(styleAt);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
  });

  it("每段标题是可折叠按钮，控制自己的 region", () => {
    const html = render(panel());
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    expect(controls.length).toBe(3);
    for (const id of controls) expect(html).toContain(`id="${id}"`);
    expect(html.match(/role="region"/g)).toHaveLength(3);
  });

  it("条目是按钮（原生 Enter/Space），整张列表只有一个 Tab 停靠点", () => {
    const html = render(panel());
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("HTML 段给出打开标签 + 行号 + 精度", () => {
    const html = render(panel());
    expect(html).toContain("&lt;button id=&quot;btn&quot; class=&quot;primary&quot;&gt;");
    expect(html).toContain("示例/index.html:24");
    expect(html).toContain("精确");
  });

  it("样式段每条带选择器、位置、声明", () => {
    const html = render(panel());
    expect(html).toContain(".card");
    expect(html).toContain("示例/style.css:12–14");
    expect(html).toContain("padding: 16px");
  });

  it("逗号列表只命中一支：选择器整条展示，另标「命中 .card」", () => {
    const html = render(
      panel({
        css: [
          cssHit({
            selector: "#hero, .card",
            specificity: [0, 1, 0],
            matchedBranches: [".card"],
          }),
        ],
      })
    );
    expect(html).toContain("#hero, .card");
    expect(html).toContain("命中 .card");
    expect(html).toContain("(0,1,0)");
  });

  it("两支都命中时不标分支（没什么可说明的）", () => {
    const html = render(panel({ css: [cssHit({ selector: "#hero, .card" })] }));
    expect(html).toContain("#hero, .card");
    expect(html).not.toContain("命中 ");
  });

  it("无法唯一对应：只给文件不给行号，并标「推断」", () => {
    const html = render(
      panel({
        css: [
          cssHit({
            selector: ".card",
            startLine: 0,
            endLine: 0,
            decls: [],
            precision: "fuzzy",
            message: "存在多条同名规则（同一文件、同样条件共 2 条），无法唯一对应",
          }),
        ],
      })
    );
    expect(html).toContain("存在多条同名规则");
    expect(html).toContain("推断");
    expect(html).not.toContain("示例/style.css:0");
  });

  it("行为段给出事件 → 处理函数 + 文件行号", () => {
    const html = render(panel());
    expect(html).toContain("click");
    expect(html).toContain("onSaveClick");
    expect(html).toContain("示例/js/app.js:12");
  });

  it("行为段没有绑定时给出空状态文案（不是空白）", () => {
    const html = render(
      panel({
        behavior: {
          hits: [],
          delegated: [],
          queries: [],
          unresolved: 0,
          problems: [],
          hint: NO_DIRECT_BINDING_HINT,
        },
      })
    );
    expect(html).toContain(NO_DIRECT_BINDING_HINT);
    expect(html).toContain("没有直接绑定");
  });

  it("只有查询没有绑定时也把查询列出来", () => {
    const html = render(
      panel({
        behavior: {
          hits: [],
          delegated: [],
          queries: [{ file: "示例/js/app.js", startLine: 30, api: "querySelector", selector: "#plain" }],
          unresolved: 0,
          problems: [],
          hint: NO_DIRECT_BINDING_HINT,
        },
      })
    );
    expect(html).toContain("相关查询");
    expect(html).toContain("#plain");
  });

  it("HTML 没定位到时不冒充行号，只说没定位", () => {
    const html = render(
      panel({
        html: {
          file: "示例/index.html",
          startLine: 0,
          endLine: 0,
          precision: "none",
          note: "源码里没定位到这个元素（多半是脚本动态生成的）",
          tag: "button",
          attrs: [],
        },
      })
    );
    expect(html).toContain("未定位");
    expect(html).toContain("脚本动态生成");
    expect(html).not.toContain("示例/index.html:0");
  });

  it("pin 状态进 aria-pressed（桌面用）", () => {
    expect(render(panel(), true)).toContain('aria-pressed="true"');
    expect(render(panel(), false)).toContain('aria-pressed="false"');
  });

  it("关闭按钮有明确标签，键盘提示在", () => {
    const html = render(panel());
    expect(html).toContain("关闭元素检视（Esc）");
    expect(html).toContain("Esc");
  });
});
