import { describe, expect, it } from "vitest";
import {
  codeExcludedNote,
  formatCount,
  readingBreakdown,
  readingStatsOf,
  readingStatsOfMarkdown,
  readingStatsSummary,
  readingStatsTitle,
  readingTimeLabel,
} from "./readingStats";

const fm = (body: string, yaml = "title: 关系代数\ntags: [笔记, 数学]") =>
  `---\n${yaml}\n---\n${body}`;

describe("readingStatsOfMarkdown · 正文口径", () => {
  it("中文逐字计，标点不算", () => {
    const s = readingStatsOfMarkdown("关系代数，是一套理论。");
    expect(s.cjk).toBe(9);
    expect(s.latin).toBe(0);
    expect(s.chars).toBe(9);
  });

  it("YAML 前言不计入，标题里的中文照常计", () => {
    const s = readingStatsOfMarkdown(fm("# 关系代数\n\n选择与投影。"));
    // tags / title 里的中文一个都不能进正文口径：4 + 5。
    expect(s.cjk).toBe(9);
    expect(s.chars).toBe(9);
  });

  it("围栏代码块默认不计，但给出未计入的字符数", () => {
    const md = ["正文四个字", "", "```ts", "const a = 1;", "console.log(a);", "```"].join("\n");
    const s = readingStatsOfMarkdown(md);
    expect(s.cjk).toBe(5); // 正文四个字
    expect(s.latin).toBe(0);
    expect(s.codeChars).toBeGreaterThan(0);
    expect(codeExcludedNote(s)).toContain("未计入");
  });

  it("代码块内部的空行不会把统计截断", () => {
    const md = ["前文", "```", "a", "", "", "b", "```", "后文"].join("\n");
    const s = readingStatsOfMarkdown(md);
    expect(s.cjk).toBe(4);
  });

  it("未闭合围栏吃到文末，与渲染器一致（不会凭空多算）", () => {
    const md = ["正文", "```ts", "const shouldNotCount = 1;", "还是代码", ""].join("\n");
    const s = readingStatsOfMarkdown(md);
    expect(s.cjk).toBe(2);
    expect(s.latin).toBe(0);
  });

  it("~~~ 围栏同样生效", () => {
    const md = ["正文两字", "~~~", "code here", "~~~"].join("\n");
    const s = readingStatsOfMarkdown(md);
    expect(s.cjk).toBe(4);
    expect(s.latin).toBe(0);
  });

  it("关闭围栏必须同字符且不短于开启围栏（```` 不会被 ``` 提前关掉）", () => {
    const md = ["正文", "````md", "```", "还在代码里", "````", "尾巴"].join("\n");
    const s = readingStatsOfMarkdown(md);
    expect(s.cjk).toBe(4); // 正文 + 尾巴
  });
});

describe("readingStatsOfMarkdown · 中英混排", () => {
  it("英文按词计，缩写与连字符算一个词", () => {
    const s = readingStatsOfMarkdown("Hello world, it's state-of-the-art RAG.");
    expect(s.latin).toBe(5);
    expect(s.cjk).toBe(0);
  });

  it("中英混排不会把中文当成西文词", () => {
    const s = readingStatsOfMarkdown("用 RAG 检索 3 个片段，再回答。");
    expect(s.cjk).toBe(9);
    expect(s.latin).toBe(2); // RAG / 3
  });

  it("链接只算可见文字，不算地址", () => {
    const s = readingStatsOfMarkdown("[维基](https://en.wikipedia.org/wiki/Relation_algebra)");
    expect(s.cjk).toBe(2);
    expect(s.latin).toBe(0);
  });

  it("双链别名只算显示出来的那半边", () => {
    const s = readingStatsOfMarkdown("见 [[集合论|集合的基本概念]]。");
    expect(s.cjk).toBe(8);
    expect(s.latin).toBe(0);
  });

  it("行内代码在句子里是要读的，照算", () => {
    const s = readingStatsOfMarkdown("用 `select` 取行。");
    expect(s.latin).toBe(1);
    expect(s.cjk).toBe(3);
  });

  it("表格分隔行不产生西文词", () => {
    const s = readingStatsOfMarkdown(["| 列 | 值 |", "|:---|:---|", "| 甲 | 乙 |"].join("\n"));
    expect(s.latin).toBe(0);
    expect(s.cjk).toBe(4); // 列 / 值 / 甲 / 乙
  });

  it("表格里的数字仍然算一个词", () => {
    expect(readingStatsOfMarkdown("| 甲 | 3 |").latin).toBe(1);
  });
});

describe("readingStatsOfMarkdown · 阅读时长", () => {
  it("400 汉字约 1 分钟", () => {
    const s = readingStatsOfMarkdown("字".repeat(400));
    expect(s.minutes).toBe(1);
  });

  it("不足一分钟也算 1 分钟，空文才是 0", () => {
    expect(readingStatsOfMarkdown("一").minutes).toBe(1);
    expect(readingStatsOfMarkdown("").minutes).toBe(0);
    expect(readingStatsOfMarkdown("   \n\n ").minutes).toBe(0);
  });

  it("中英按各自速度折算后相加再上取整", () => {
    // 400 汉字 = 1 分，200 西文词 = 1 分 → 2 分。
    const s = readingStatsOfMarkdown(`${"字".repeat(400)} ${"word ".repeat(200)}`);
    expect(s.minutes).toBe(2);
  });

  it("只有代码时读 0 分钟，但说明里点出代码", () => {
    const s = readingStatsOfMarkdown("```js\nconst a = 1;\n```");
    expect(s.chars).toBe(0);
    expect(s.minutes).toBe(0);
    expect(readingStatsSummary(s)).toContain("字");
    expect(readingBreakdown(s)).toBe("只有代码，没有正文");
  });
});

describe("readingStatsOfHtml", () => {
  it("剥掉标签与 script/style 再计数", () => {
    const s = readingStatsOf(
      "<h1>标题</h1><script>var tracking = 1;</script><p>正文 hello world</p>",
      "html"
    );
    expect(s.cjk).toBe(4);
    expect(s.latin).toBe(2);
  });
});

describe("展示口径", () => {
  it("千分位", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("时长文案", () => {
    expect(readingTimeLabel({ minutes: 0 })).toBe("0 分钟");
    expect(readingTimeLabel({ minutes: 1 })).toBe("约 1 分钟");
    expect(readingTimeLabel({ minutes: 12 })).toBe("约 12 分钟");
  });

  it("分项只报非零项，避免中文文档出现「西文 0 词」", () => {
    const cn = readingStatsOfMarkdown("纯中文正文");
    expect(readingBreakdown(cn)).toBe("中文 5");
    const mixed = readingStatsOfMarkdown("中文 and English");
    expect(readingBreakdown(mixed)).toBe("中文 2 · 西文 2 词");
  });

  it("没有代码就不提代码那茬", () => {
    expect(codeExcludedNote(readingStatsOfMarkdown("纯文本"))).toBeNull();
  });

  it("摘要给一行，供浮动条 / aria-label 复用", () => {
    expect(readingStatsSummary(readingStatsOfMarkdown("字".repeat(800)))).toBe(
      "800 字 · 约 2 分钟"
    );
    expect(readingStatsSummary(readingStatsOfMarkdown(""))).toBe("空文档");
  });

  it("悬停提示把摘要、分项、代码说明拼成一行", () => {
    const s = readingStatsOfMarkdown(["中文", "```js", "const a = 1;", "```"].join("\n"));
    const title = readingStatsTitle(s);
    expect(title).toContain("字");
    expect(title).toContain("约 1 分钟");
    expect(title).toContain("中文 2");
    expect(title).toContain("未计入");
    // 没有代码时不追加空的说明段。
    expect(readingStatsTitle(readingStatsOfMarkdown("纯文本"))).not.toContain("｜｜");
    expect(readingStatsTitle(readingStatsOfMarkdown("纯文本")).split("｜")).toHaveLength(2);
  });
});
