// @vitest-environment jsdom
/**
 * 篇级统计的可见性契约。
 *
 * 用户验收的是两件事：中英混排要算得合理；专注模式里也必须看得到。
 * 这里用静态渲染 + 源码断言钉住「浮条里有、弹层里有」，不挂 store / CodeMirror。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadingStatsCard } from "./ReadingStatsCard";
import { readingStatsOfMarkdown } from "@/lib/readingStats";

const mixed = ["# 标题", "", "中文正文八个字。", "", "```ts", "const a = 1;", "```", "", "Some English words."].join(
  "\n"
);

describe("ReadingStatsCard", () => {
  it("完整卡片给出字数、时长、中英分项与代码说明", () => {
    const html = renderToStaticMarkup(<ReadingStatsCard stats={readingStatsOfMarkdown(mixed)} />);
    expect(html).toContain('data-reading-stats=""');
    expect(html).toContain("本篇");
    // 正文：标题 2 + 中文正文八个字 7 + Some English words 3 词 = 12
    expect(html).toContain(">12<");
    expect(html).toContain("约 1 分钟");
    expect(html).toContain("中文 9");
    expect(html).toContain("西文 3 词");
    expect(html).toContain("未计入");
  });

  it("紧凑模式只留一行，适合浮动条这种窄位置", () => {
    const html = renderToStaticMarkup(
      <ReadingStatsCard compact stats={readingStatsOfMarkdown("字".repeat(800))} />
    );
    expect(html).not.toContain("data-reading-stats");
    expect(html).not.toContain("本篇");
    expect(html).toContain("800 字 · 约 2 分钟");
  });

  it("纯英文文档不渲染中文 0", () => {
    const html = renderToStaticMarkup(<ReadingStatsCard stats={readingStatsOfMarkdown("hi there")} />);
    expect(html).not.toContain("中文 0");
    expect(html).toContain("西文 2 词");
  });
});

describe("专注 × 阅读弹层入口", () => {
  it("专注浮动条里带篇级统计，窄屏也不收起（顶栏整块不渲染）", () => {
    const src = readFileSync(resolve(__dirname, "./MdFocusExitButton.tsx"), "utf8");
    expect(src).toContain("ReadingStatsCard");
    expect(src).toContain('data-focus-stats=""');
    // 专注时这是唯一的字数入口，不能被 max-sm:hidden 收掉。
    const block = src.slice(src.indexOf('data-focus-stats="'));
    expect(block.slice(0, 120)).not.toContain("max-sm:hidden");
  });

  it("阅读弹层顶部有无条件渲染的统计卡（MD 与 HTML、预览与源码都能看到）", () => {
    const src = readFileSync(resolve(__dirname, "./topbar/ReadingPopover.tsx"), "utf8");
    // 统计卡在 isHtml / viewMode 分支之外，否则源码视图下就看不到字数了。
    const statsIdx = src.indexOf("<ReadingStatsCard");
    const firstBranch = src.indexOf("{!isHtml && viewMode");
    expect(statsIdx).toBeGreaterThan(-1);
    expect(firstBranch).toBeGreaterThan(statsIdx);
  });
});

describe("三处口径一致", () => {
  it("正文页、状态栏、阅读弹层都走 readingStatsOf*", () => {
    const reader = readFileSync(resolve(__dirname, "MarkdownReader.tsx"), "utf8");
    const status = readFileSync(resolve(__dirname, "StatusBar.tsx"), "utf8");
    const popover = readFileSync(resolve(__dirname, "topbar/ReadingPopover.tsx"), "utf8");
    expect(reader).toContain("readingStatsOfMarkdown");
    expect(status).toContain("readingStatsOf(");
    expect(popover).toContain("useReadingStats");
    // 别再退回那个会数 `#` 与链接地址的旧函数。
    expect(reader).not.toContain("countWords(");
    expect(status).not.toContain("countWords(");
  });
});
