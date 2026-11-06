import { describe, expect, it } from "vitest";
import {
  TOC_MARKER,
  collectTocEntries,
  hasTocMarker,
  insertTocMarker,
  isTocMarkerLine,
  planTocInsert,
  tocInsertOffset,
} from "./tocMarker";

describe("TOC 标记识别", () => {
  it("只认独占一行的 <!-- toc -->", () => {
    expect(isTocMarkerLine("<!-- toc -->")).toBe(true);
    expect(isTocMarkerLine("  <!-- toc -->  ")).toBe(true);
    expect(isTocMarkerLine("<!-- TOC -->")).toBe(true);
    expect(isTocMarkerLine("<!--toc-->")).toBe(true);
  });

  it("行内夹了别的内容就不算（别把备注误当目录）", () => {
    expect(isTocMarkerLine("> <!-- toc -->")).toBe(false);
    expect(isTocMarkerLine("<!-- toc --> 后面还有字")).toBe(false);
    expect(isTocMarkerLine("[TOC]")).toBe(false);
    expect(isTocMarkerLine("```")).toBe(false);
  });

  it("hasTocMarker 扫全文", () => {
    expect(hasTocMarker("# A\n\n<!-- toc -->\n")).toBe(true);
    expect(hasTocMarker("# A\n\n正文\n")).toBe(false);
  });
});

describe("planTocInsert", () => {
  it("没有标记时允许插入", () => {
    expect(planTocInsert("# A\n")).toEqual({ kind: "insert", reason: "no-marker" });
  });

  it("已有标记时明确拒绝，不塞第二个", () => {
    expect(planTocInsert("<!-- toc -->\n\n# A\n")).toEqual({
      kind: "exists",
      reason: "already-inserted",
    });
  });
});

describe("tocInsertOffset / insertTocMarker", () => {
  it("插在第一个标题前（frontmatter 之后）", () => {
    const md = "---\ntitle: 甲\n---\n\n# 正文首标题\n\ntext\n";
    const offset = tocInsertOffset(md);
    expect(md.slice(offset).startsWith("# 正文首标题")).toBe(true);
  });

  it("插进去后能立刻被识别，且标记位置回传正确", () => {
    const md = "# 正文首标题\n\n内容\n";
    const { text, markerStart } = insertTocMarker(md);
    expect(text.startsWith(`${TOC_MARKER}\n\n# 正文首标题`)).toBe(true);
    expect(text.slice(markerStart, markerStart + TOC_MARKER.length)).toBe(TOC_MARKER);
    expect(hasTocMarker(text)).toBe(true);
  });

  it("frontmatter 不会被劈开", () => {
    const md = "---\ntitle: 甲\n---\n\n# 标题\n";
    const { text } = insertTocMarker(md);
    expect(text.indexOf("---")).toBe(0);
    const fmEnd = text.indexOf("---", 3);
    expect(text.slice(0, fmEnd)).toContain("title: 甲");
    expect(text.indexOf(TOC_MARKER)).toBeGreaterThan(fmEnd);
  });

  it("没有标题时插到文首，不会把标记塞进段落中间", () => {
    const md = "只有正文，没有标题。\n";
    const { text } = insertTocMarker(md);
    expect(text.startsWith(TOC_MARKER)).toBe(true);
  });

  it("连续插两次得到第二份计划为 exists", () => {
    const once = insertTocMarker("# A\n").text;
    expect(planTocInsert(once).kind).toBe("exists");
  });
});

describe("collectTocEntries", () => {
  it("取 h1–h4，跳过 frontmatter", () => {
    const entries = collectTocEntries(
      "---\ntitle: 甲\n---\n\n# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n"
    );
    expect(entries.map((e) => [e.level, e.text])).toEqual([
      [1, "一"],
      [2, "二"],
      [3, "三"],
      [4, "四"],
    ]);
  });

  it("id 与 rehype-slug 同规则，重复标题会加后缀", () => {
    const entries = collectTocEntries("# 小节\n\n# 小节\n");
    expect(entries.map((e) => e.id)).toEqual(["小节", "小节-1"]);
  });

  it("围栏代码块里的 # 不算标题", () => {
    const entries = collectTocEntries(
      "# 真标题\n\n```bash\n# 这是注释\n# 也是注释\n```\n\n## 另一个\n"
    );
    expect(entries.map((e) => e.text)).toEqual(["真标题", "另一个"]);
  });

  it("$$ 公式块里的 # 不算标题", () => {
    const entries = collectTocEntries("# 真\n\n$$\na # b\n$$\n\n## 假不了\n");
    expect(entries.map((e) => e.text)).toEqual(["真", "假不了"]);
  });

  it("去掉行内强调与行尾闭合井号", () => {
    const entries = collectTocEntries("## **重点** 小节 ##\n");
    expect(entries[0]?.text).toBe("重点 小节");
  });
});
