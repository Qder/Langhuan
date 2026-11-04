import { describe, expect, it } from "vitest";
import { buildMdPlainMap } from "./mdPlainMap";
import { locateInMarkdown, isTrivialSelection, locateMdTextRunInRange } from "./mdLocate";
import { frontmatterOffset, lineAtOffset } from "./frontmatter";
import { locateInHtml, buildHtmlVisibleMap } from "./htmlLocate";
import { normalizeNewlines } from "../utils";

describe("frontmatterOffset", () => {
  it("adds stripped length", () => {
    const src = `---\ntitle: hi\ntags: [a]\n---\n\n# Hello\n`;
    const off = frontmatterOffset(src);
    expect(src.slice(off)).toBe("\n# Hello\n");
    expect(lineAtOffset(src, off + 1)).toBe(6);
  });
});

describe("buildMdPlainMap", () => {
  it("maps bold + inline code + link spanning selection", () => {
    const slice = `这是 **加粗** 与 \`code\` 和 [链接](https://example.com) 结束`;
    const { plain, map } = buildMdPlainMap(slice);
    expect(plain).toBe("这是 加粗 与 code 和 链接 结束");
    const sel = "加粗 与 code 和 链接";
    const idx = plain.indexOf(sel);
    expect(idx).toBeGreaterThan(0);
    const start = map[idx];
    const end = map[idx + sel.length];
    expect(slice.slice(start, end)).toContain("**");
    expect(slice.slice(start, end)).toContain("`code`");
    expect(slice.slice(start, end)).toContain("[链接](");
  });

  it("maps wikilinks to label without shifting", () => {
    const slice = `试试打开 [[快速上手]]，或看看。`;
    const { plain, map } = buildMdPlainMap(slice);
    expect(plain).toContain("快速上手");
    expect(plain).not.toContain("[[");
    const idx = plain.indexOf("快速上手");
    expect(idx).toBeGreaterThanOrEqual(0);
    // each plain char maps inside the wikilink body
    for (let k = 0; k < "快速上手".length; k++) {
      expect(slice[map[idx + k]]).toBe("快速上手"[k]);
    }
    // exclusive end may land after closing ]], which is fine for sentence locate
    expect(slice.slice(map[idx], map[idx + "快速上手".length])).toContain("快速上手");
  });
});

describe("callout 的纯文本映射", () => {
  const slice = "> [!tip] 自定义标题\n> 正文里的 **加粗** 词\n";

  it("标记行只丢 [!tip]，自定义标题与正文保留", () => {
    const { plain } = buildMdPlainMap(slice);
    expect(plain).not.toContain("[!");
    expect(plain).toContain("自定义标题");
    expect(plain).toContain("加粗");
  });

  it("映射仍指回源码（卡片里选词 → 定位到原行）", () => {
    const { plain, map } = buildMdPlainMap(slice);
    const idx = plain.indexOf("自定义标题");
    expect(idx).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < 5; k++) {
      expect(slice[map[idx + k]]).toBe("自定义标题"[k]);
    }
  });

  it("没有自定义标题时，标记行整行都是语法", () => {
    const { plain } = buildMdPlainMap("> [!NOTE]\n> 正文\n");
    expect(plain.replace(/\s/g, "")).toBe("正文");
  });
});

describe("locateInMarkdown", () => {
  const fm = `---\ntitle: 欢迎\ntags: [入门]\n---\n\n`;
  const body = `# 欢迎来到琅嬛\n\n琅嬛是一座私人藏书阁——把 **Markdown 笔记**、完整 HTML 页面放进同一套目录。\n\n重复词 重复词 重复词\n\n试试打开 [[快速上手]]，结束。\n`;
  const source = fm + body;
  const off = frontmatterOffset(source);

  it("rejects trivial selection", () => {
    expect(isTrivialSelection("  ")).toBe(true);
    expect(isTrivialSelection("。")).toBe(true);
  });

  it("1. locates Chinese paragraph", () => {
    const para = "琅嬛是一座私人藏书阁——把 **Markdown 笔记**、完整 HTML 页面放进同一套目录。";
    const start = source.indexOf(para);
    const end = start + para.length;
    const result = locateInMarkdown({
      source,
      selectedText: "琅嬛是一座私人藏书阁——把 Markdown 笔记、完整 HTML 页面放进同一套目录。",
      startBlock: { start, end },
      endBlock: { start, end },
      anchorPlainOffset: 0,
    });
    expect(result.precision).toBe("exact");
    expect(source.slice(result.start, result.end)).toContain("**Markdown 笔记**");
    expect(result.message).toMatch(/第 \d+ 行/);
  });

  it("2. selection spanning bold+code+link includes markers", () => {
    const slice = `前 **加粗** 与 \`code\` 和 [链接](https://x.com) 后`;
    const src = fm + slice + "\n";
    const start = src.indexOf(slice);
    const result = locateInMarkdown({
      source: src,
      selectedText: "加粗 与 code 和 链接",
      startBlock: { start, end: start + slice.length },
      endBlock: { start, end: start + slice.length },
    });
    expect(result.precision).toBe("exact");
    const hit = src.slice(result.start, result.end);
    expect(hit).toContain("**");
    expect(hit).toContain("`");
    expect(hit).toContain("[链接](");
  });

  it("3. duplicate word picks nth by anchor", () => {
    const line = "重复词 重复词 重复词";
    const start = source.indexOf(line);
    const end = start + line.length;
    const { plain } = buildMdPlainMap(source.slice(start, end));
    const third = plain.indexOf("重复词", plain.indexOf("重复词", plain.indexOf("重复词") + 1) + 1);
    const result = locateInMarkdown({
      source,
      selectedText: "重复词",
      startBlock: { start, end },
      endBlock: { start, end },
      anchorPlainOffset: third,
    });
    expect(result.precision).toBe("exact");
    // third occurrence in source
    const first = source.indexOf("重复词", start);
    const second = source.indexOf("重复词", first + 1);
    const thirdSrc = source.indexOf("重复词", second + 1);
    expect(result.start).toBe(thirdSrc);
  });

  it("4. wikilink sentence does not drift", () => {
    const line = "试试打开 [[快速上手]]，结束。";
    const start = source.indexOf(line);
    const end = start + line.length;
    const result = locateInMarkdown({
      source,
      selectedText: "试试打开 快速上手，结束。",
      startBlock: { start, end },
      endBlock: { start, end },
    });
    expect(result.precision).toBe("exact");
    expect(source.slice(result.start, result.end)).toContain("[[快速上手]]");
  });

  it("5. frontmatter offsets still correct", () => {
    expect(off).toBeGreaterThan(10);
    const heading = "# 欢迎来到琅嬛";
    const start = source.indexOf(heading);
    const result = locateInMarkdown({
      source,
      selectedText: "欢迎来到琅嬛",
      startBlock: { start, end: start + heading.length },
      endBlock: { start, end: start + heading.length },
    });
    expect(result.start).toBeGreaterThanOrEqual(off);
    expect(source.slice(result.start, result.end)).toContain("欢迎来到琅嬛");
  });
});

describe("locateInHtml", () => {
  const html = `<!DOCTYPE html>
<html><head><style>.x{color:red}</style></title></head>
<body>
  <div class="card">
    <h1>沙箱里的小交互</h1>
    <p>此页在琅嬛中以 sandbox 预览，脚本可运行，但不能读父页面。</p>
    <div id="count">0</div>
  </div>
  <script>
    let n = 0;
    document.getElementById("count").textContent = "42-script-only";
  </script>
</body></html>`;

  it("6a. locates static paragraph", () => {
    const result = locateInHtml({
      source: html,
      text: "此页在琅嬛中以 sandbox 预览，脚本可运行，但不能读父页面。",
      before: "小交互",
      after: "0",
    });
    expect(result.precision).toBe("exact");
    expect(result.message).toMatch(/第 \d+ 行/);
  });

  it("6b. script-generated text locates the string in <script>", () => {
    // only inside <script> string → jump to the generating literal
    const resultInScript = locateInHtml({
      source: html,
      text: "42-script-only",
      before: "",
      after: "",
    });
    expect(resultInScript.precision).toBe("script");
    expect(resultInScript.message).toMatch(/脚本数据中的第 \d+ 行/);
    expect(html.slice(resultInScript.start, resultInScript.end)).toBe("42-script-only");
    expect(resultInScript.start).toBeGreaterThan(0);

    // dynamic counter value never present in source
    const resultDynamic = locateInHtml({
      source: html,
      text: "12345",
      before: "",
      after: "",
    });
    expect(resultDynamic.precision).toBe("none");
    expect(resultDynamic.message).toContain("脚本生成");
  });

  it("6c. locates JSON data-driven desc inside script (html-elements pattern)", () => {
    const page = `<!DOCTYPE html><html><body>
<div id="main"></div>
<script>
const DATA = [
  { "tag": "h6", "desc": "六级章节标题（六个级别中最低）。", "example": "<h6>六级标题</h6>" }
];
document.getElementById("main").textContent = DATA[0].desc;
</script>
</body></html>`;
    const result = locateInHtml({
      source: page,
      text: "六级章节标题（六个级别中最低）。",
      before: "",
      after: "",
    });
    expect(result.precision).toBe("script");
    expect(result.message).toMatch(/脚本数据中的第 \d+ 行/);
    expect(page.slice(result.start, result.end)).toContain("六级章节标题");
  });

  it("6d. noisy card selection still finds desc via candidate", () => {
    const page = `<!DOCTYPE html><html><body><script>
const el = { "desc": "六级章节标题（六个级别中最低）。" };
</script></body></html>`;
    const result = locateInHtml({
      source: page,
      text: "<h6>常用 六级章节标题（六个级别中最低）。 示例",
      before: "",
      after: "",
    });
    expect(["script", "fuzzy"]).toContain(result.precision);
    expect(page.slice(result.start, result.end)).toContain("六级章节标题");
  });


  it("6e. stem selection hits stem JSON field, not adjacent answer (quiz card)", () => {
    const stem = "某勘探队有 3 名队员，取得一块矿样。三人的判断如下：";
    const page = `<!DOCTYPE html><html><body><div id="q"></div><script>
const QUIZ = [{
  "id": "hw2-1-15",
  "stem": "${stem}\\n- 甲：这不是铁，也不是铜",
  "answer": "**结论：矿样是铁**\\nT=1, F=1 → 两个都对 **全对**\\n丙全对"
}];
</script></body></html>`;
    const result = locateInHtml({ source: page, text: stem, before: "", after: "" });
    expect(result.precision).toBe("script");
    const hit = page.slice(result.start, result.end);
    expect(hit).toBe(stem);
    expect(hit).not.toContain("全对");
    // stem field comes before answer on the next object lines
    expect(result.start).toBeLessThan(page.indexOf('"answer"'));
  });

  it("6f. CRLF source offsets match LF doc (CodeMirror)", () => {
    const stem = "某勘探队有 3 名队员，取得一块矿样。三人的判断如下：";
    // Simulate a Windows-saved homework file: many CRLF lines then stem/answer adjacency.
    const lfBody = `<!DOCTYPE html>
<html><body>
<div id="main"></div>
<script>
const QUIZ = [
  {
    "id": "hw2-1-15",
    "stem": "${stem}\\n- 甲：这不是铁",
    "answer": "**结论**\\nT=1, F=1 → 两个都对 **全对**"
  }
];
</script>
</body></html>`;
    const crlf = lfBody.replace(/\n/g, "\r\n");
    const result = locateInHtml({ source: crlf, text: stem, before: "", after: "" });
    const lf = normalizeNewlines(crlf);
    expect(result.precision).toBe("script");
    expect(lf.slice(result.start, result.end)).toBe(stem);
    // Applying CRLF-naive offsets to LF doc must NOT be required anymore:
    // wrong end would land inside the answer "全对" fragment.
    const naiveEnd = crlf.indexOf(stem) + stem.length;
    expect(lf.slice(Math.min(naiveEnd, lf.length - 20), Math.min(naiveEnd, lf.length - 20) + 20)).not.toBe(
      lf.slice(result.end, result.end + 20)
    );
    expect(lf.slice(result.start, result.end)).not.toContain("全对");
  });

  it("visible map skips style/script", () => {
    const { visible } = buildHtmlVisibleMap(html);
    expect(visible).toContain("沙箱里的小交互");
    expect(visible).not.toContain("color:red");
    expect(visible).not.toContain("let n");
  });
});

describe("locateMdTextRunInRange", () => {
  const para = `这是 **加粗词** 与 [链接文字](https://example.com) 还有汉字段落。`;
  const source = `---\ntitle: t\n---\n\n${para}\n`;
  const start = source.indexOf(para);
  const end = start + para.length;
  const { plain } = buildMdPlainMap(para);

  it("maps click inside bold to bold body chars, not whole paragraph", () => {
    const idx = plain.indexOf("加粗词");
    expect(idx).toBeGreaterThanOrEqual(0);
    // click middle char 粗
    const result = locateMdTextRunInRange({
      source,
      container: { start, end },
      plainOffset: idx + 1,
    });
    expect(result.precision).toBe("exact");
    const hit = source.slice(result.start, result.end);
    expect(hit).toContain("加粗词");
    expect(hit).not.toContain("这是");
    expect(hit.length).toBeLessThan(para.length);
    // source selection is the bare chars inside **, not the whole block
    expect(hit.replace(/\*/g, "")).toBe("加粗词");
  });

  it("maps Latin word under caret", () => {
    const slice = `Hello **world** end`;
    const src = `# t\n\n${slice}\n`;
    const s0 = src.indexOf(slice);
    const { plain: p2 } = buildMdPlainMap(slice);
    const wi = p2.indexOf("world");
    const result = locateMdTextRunInRange({
      source: src,
      container: { start: s0, end: s0 + slice.length },
      plainOffset: wi + 1,
    });
    expect(result.precision).toBe("exact");
    expect(src.slice(result.start, result.end)).toBe("world");
  });

  it("blank offset falls back to none (block-level for caller)", () => {
    const space = plain.indexOf(" ");
    expect(space).toBeGreaterThanOrEqual(0);
    const result = locateMdTextRunInRange({
      source,
      container: { start, end },
      plainOffset: space,
    });
    expect(result.precision).toBe("none");
  });

  it("caps long CJK run at 24", () => {
    const long = "汉".repeat(40);
    const slice = `前 ${long} 后`;
    const src = slice + "\n";
    const { plain: p3 } = buildMdPlainMap(slice);
    const mid = p3.indexOf("汉") + 20;
    const result = locateMdTextRunInRange({
      source: src,
      container: { start: 0, end: slice.length },
      plainOffset: mid,
    });
    expect(result.precision).toBe("exact");
    expect(src.slice(result.start, result.end).length).toBe(24);
  });
});
