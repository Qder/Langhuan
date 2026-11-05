/**
 * 预览排版的「CSS 契约」测试。
 *
 * 样式没法在 node 环境里算出来，但可以把「不许再出现的东西」钉成断言：
 * 深色代码砖、mac 交通灯、写死的跨主题颜色、h3 的 ◆ 花纹，删了就该红。
 * 这些正是这一期的审美约束 —— 与其靠眼睛，不如让回归自己撞上来。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPORT_CSS } from "./export/standalone";
import { CALLOUT_KINDS, CALLOUT_LABELS } from "./callout";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const reader = readFileSync(new URL("../components/MarkdownReader.tsx", import.meta.url), "utf8");
const fenceEditor = readFileSync(
  new URL("../components/editor/InlineCodeFenceEditor.tsx", import.meta.url),
  "utf8"
);
const mermaid = readFileSync(new URL("../components/MermaidBlock.tsx", import.meta.url), "utf8");

/** 去掉注释再断言：说明文字里提到「不许 #1a1814」是对的，不算违规。 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const cssCode = stripComments(css);

describe("不再有跨主题的深色砖 / 交通灯", () => {
  it("globals.css 没有写死的深色代码砖配色", () => {
    expect(cssCode).not.toMatch(/#1a1814|#ece4d2/i);
  });

  it("mac 红黄绿灯已移除（样式与三处 chrome）", () => {
    for (const banned of [/#ff5f56/i, /#ffbd2e/i, /#27c93f/i]) {
      expect(cssCode).not.toMatch(banned);
      expect(stripComments(reader)).not.toMatch(banned);
      expect(stripComments(mermaid)).not.toMatch(banned);
      expect(stripComments(fenceEditor)).not.toMatch(banned);
    }
  });

  it("MarkdownReader 不再引 highlight.js 的深色主题", () => {
    expect(stripComments(reader)).not.toContain("github-dark");
  });

  it("导出用的纸面 CSS 也不再是深色代码块", () => {
    expect(EXPORT_CSS).not.toContain("#1a1814");
    expect(EXPORT_CSS).not.toContain("#ece4d2");
    expect(EXPORT_CSS).toContain("var(--code-bg)");
  });
});

describe("代码块走主题 token", () => {
  it("浅色与深色两组都定义了 --code-*", () => {
    for (const name of ["--code-bg", "--code-fg", "--code-border", "--code-gutter-bg", "--code-gutter-fg"]) {
      const hits = cssCode.split(name).length - 1;
      expect(hits, name).toBeGreaterThanOrEqual(3); // 浅色组 + 松烟 + 赛博
    }
  });

  it("浅色组用纸色派生、深色组用深底（第 6 个色相不能只是黑）", () => {
    expect(cssCode).toMatch(/--code-bg:\s*color-mix\(/);
    // 深色组（松烟）里代码底从 --bg 派生，而不是沿用浅色组那一份
    const darkBlock = cssCode.slice(cssCode.indexOf('html[data-theme="songyan"]'));
    expect(darkBlock).toContain("--code-bg: color-mix");
  });

  it(".hljs 不再自带背景/文字色，改由 --code-fg 决定", () => {
    expect(cssCode).toMatch(/\.hljs\s*\{[^}]*color:\s*var\(--code-fg\)/);
    expect(cssCode).toMatch(/\.hljs\s*\{[^}]*background:\s*transparent/);
  });

  it("语法色是主题变量，不是硬编码在规则里", () => {
    const synTokens = cssCode.match(/--syn-[a-z]+:/g) ?? [];
    expect(synTokens.length).toBeGreaterThanOrEqual(24); // 8 色 × 3 组
    expect(cssCode).toMatch(/\.hljs-keyword[\s\S]{0,400}?color:\s*var\(--syn-keyword\)/);
    expect(cssCode).toMatch(/\.hljs-string[\s\S]{0,400}?color:\s*var\(--syn-string\)/);
  });

  it(".lh-codeblock / gutter 用 token 而不是 rgba(236,228,210)", () => {
    const codeblock = cssCode.slice(cssCode.indexOf(".lh-codeblock {"));
    expect(codeblock).toContain("background: var(--code-bg)");
    expect(cssCode).toContain("color: var(--code-gutter-fg)");
    expect(cssCode).toContain("background: var(--code-gutter-bg)");
  });

  it("编辑态（InlineCodeFenceEditor）跟预览用同一套 token", () => {
    expect(fenceEditor).toContain("var(--code-bg)");
    expect(fenceEditor).toContain("lh-codeblock-chrome");
  });
});

describe("表格 / 插图 / 图表不撑破版心", () => {
  it("表格有横向滚动外壳", () => {
    expect(cssCode).toMatch(/\.lh-md-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(cssCode).toMatch(/\.lh-md-table-wrap\s*\{[^}]*max-width:\s*100%/);
    expect(reader).toContain("lh-md-table-wrap");
  });

  it("插图限高并居中，图注 muted 居中", () => {
    expect(cssCode).toMatch(/\.lh-md-img\s*\{[^}]*max-height:\s*min\(70vh, 720px\)/);
    expect(cssCode).toMatch(/\.lh-md-img\s*\{[^}]*object-fit:\s*contain/);
    expect(cssCode).toMatch(/\.lh-md-img\s*\{[^}]*margin-inline:\s*auto/);
    expect(cssCode).toMatch(/\.lh-md-figcaption\s*\{[^}]*color:\s*var\(--muted\)/);
    expect(reader).toContain("lh-md-figure");
  });

  it("mermaid 容器可横向滚动", () => {
    expect(cssCode).toMatch(/\.lh-mermaid-svg\s*\{[^}]*overflow-x:\s*auto/);
    expect(mermaid).toContain("lh-mermaid-svg");
  });
});

describe("标题与列表收一收", () => {
  it("h3 不再挂 ◆ 花纹", () => {
    expect(cssCode).not.toContain("◆");
    expect(cssCode).not.toMatch(/h3::before/);
  });

  it("h2 的短下划线保留", () => {
    expect(cssCode).toMatch(/h2::before\s*\{[^}]*width:\s*28px/);
  });

  it("第二层列表换成空心点，缩进比第一层宽", () => {
    expect(cssCode).toMatch(/ul ul > li::before[\s\S]{0,120}box-shadow:\s*inset/);
    expect(cssCode).toMatch(/\.prose-langhuan ul ul\s*\{[^}]*padding-left:\s*1\.45em/);
  });
});

describe("五种 callout 的色相表仍在", () => {
  it("kind 表是五种，且有默认标题", () => {
    for (const kind of ["note", "tip", "important", "warning", "caution"]) {
      expect(CALLOUT_KINDS).toContain(kind);
      expect(CALLOUT_LABELS[kind as keyof typeof CALLOUT_LABELS]).toBeTruthy();
    }
    expect(CALLOUT_KINDS).toHaveLength(5);
  });

  it("tip / note 各用主题色相，其余三种挂在 --accent 一系", () => {
    expect(cssCode).toMatch(/\.callout\.tip\s*\{[^}]*var\(--teal\)/);
    expect(cssCode).toMatch(/\.callout\.note\s*\{[^}]*var\(--gold\)/);
    // warn 是 warning 的历史别名，与 important 共用 accent
    expect(cssCode).toMatch(/\.callout\.warn\s*\{[^}]*var\(--accent\)/);
    expect(cssCode).toMatch(/\.callout\.important\s*\{[^}]*var\(--accent\)/);
    // warning / caution 是 accent 与 gold / fg 的混色，不是新增色
    expect(cssCode).toMatch(/\.callout\.warning\s*\{[^}]*color-mix\(/);
    expect(cssCode).toMatch(/\.callout\.caution\s*\{[^}]*color-mix\(/);
  });

  it("rehypeCallout 的 className 与 globals.css 的选择器对得上", () => {
    const calloutPlugin = stripComments(
      readFileSync(new URL("./rehypeCallout.ts", import.meta.url), "utf8")
    );
    // warning 同时带 warning / warn 两个类，老样式和手写 HTML 都不掉色
    expect(calloutPlugin).toContain('"warning", "warn"');
    expect(calloutPlugin).toContain("callout-${kind}");
  });
});
