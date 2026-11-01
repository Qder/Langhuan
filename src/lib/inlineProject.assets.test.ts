import { describe, expect, it, vi } from "vitest";
import { parse } from "parse5";
import { buildHtmlPlainMap } from "./locate/htmlPlainMap";
import {
  MAX_INLINE_TOTAL_BYTES,
  MAX_INLINE_ASSET_BYTES,
  toDataUrl,
} from "./projectAssets";
import {
  inlineProjectHtml,
  type AssetReadResult,
  type InlineOptions,
  type ProjectAsset,
} from "./inlineProject";

/** 假字节：内容可读、可回解，便于断言「data URL 装的确实是这张图」。 */
function assetOf(text: string, mime = "image/png", bytes?: number): ProjectAsset {
  return {
    mime,
    base64: Buffer.from(text, "utf8").toString("base64"),
    ...(bytes === undefined ? {} : { bytes }),
  };
}

type Files = {
  text?: Record<string, string>;
  assets?: Record<string, AssetReadResult>;
};

function setup(files: Files) {
  const readFile = (path: string) => files.text?.[path] ?? null;
  const readAsset = vi.fn((path: string): AssetReadResult => files.assets?.[path] ?? "missing");
  const run = (html: string, extra?: Partial<InlineOptions>) =>
    inlineProjectHtml(html, { readFile, readAsset, ...extra });
  return { run, readAsset };
}

/** 从 data URL 里把字节还原成字符串（验证装的不是空壳）。 */
function decodeDataUrl(url: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
  if (!m) throw new Error(`不是 base64 data URL: ${url.slice(0, 40)}`);
  return { mime: m[1], data: Buffer.from(m[2], "base64").toString("utf8") };
}

/** 取出 HTML 里某个属性值的原始文本（避免被 data URL 里的字符干扰）。 */
function attrOf(html: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, "i");
  return re.exec(html)?.[1] ?? null;
}

function countElements(html: string): number {
  let n = 0;
  const walk = (node: { tagName?: string; childNodes?: unknown[] }) => {
    if (node.tagName) n += 1;
    for (const child of node.childNodes || []) walk(child as { childNodes?: unknown[] });
  };
  walk(parse(html) as unknown as { childNodes?: unknown[] });
  return n;
}

describe("HTML 里的图片 / 图标", () => {
  it("img src → data URL，字节没被改写", () => {
    const { run } = setup({ assets: { "img/logo.png": assetOf("PNG-BYTES") } });
    const out = run(`<img src="img/logo.png" alt="logo">`);
    const src = attrOf(out.html, "img", "src");
    expect(src?.startsWith("data:image/png;base64,")).toBe(true);
    expect(decodeDataUrl(src!)).toEqual({ mime: "image/png", data: "PNG-BYTES" });
    expect(out.assets).toEqual(["img/logo.png"]);
    expect(out.warnings).toEqual([]);
    // 其它属性一个字节都不动
    expect(out.html).toContain('alt="logo"');
  });

  it("中文 + 空格 + 百分号编码的路径", () => {
    const { run } = setup({ assets: { "img/封面 图.png": assetOf("CN") } });
    const out = run(`<img src="img/%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png">`);
    expect(out.assets).toEqual(["img/封面 图.png"]);
    expect(decodeDataUrl(attrOf(out.html, "img", "src")!).data).toBe("CN");
  });

  it("原样写中文和空格也能解析", () => {
    const { run } = setup({ assets: { "img/封面 图.png": assetOf("CN2") } });
    const out = run(`<img src="img/封面 图.png">`);
    expect(decodeDataUrl(attrOf(out.html, "img", "src")!).data).toBe("CN2");
  });

  it("../ 按文档目录归一（子目录里的页面）", () => {
    const { run } = setup({ assets: { "img/a.png": assetOf("A") } });
    const out = run(`<img src="../img/a.png">`, { baseDir: "pages" });
    expect(out.assets).toEqual(["img/a.png"]);
    expect(attrOf(out.html, "img", "src")?.startsWith("data:image/png")).toBe(true);
  });

  it("查询串 / 锚点不影响找文件", () => {
    const { run } = setup({ assets: { "img/a.png": assetOf("A") } });
    const out = run(`<img src="img/a.png?v=2#frag">`);
    expect(out.assets).toEqual(["img/a.png"]);
    expect(out.warnings).toEqual([]);
  });

  it("srcset 逐候选替换且保留描述符", () => {
    const { run } = setup({
      assets: { "img/a.png": assetOf("1X"), "img/a@2x.png": assetOf("2X") },
    });
    const out = run(`<img src="img/a.png" srcset="img/a.png 1x, img/a@2x.png 2x">`);
    const srcset = attrOf(out.html, "img", "srcset")!;
    const parts = srcset.split(" 1x, ");
    expect(parts).toHaveLength(2);
    expect(decodeDataUrl(parts[0]).data).toBe("1X");
    expect(parts[1].endsWith(" 2x")).toBe(true);
    expect(decodeDataUrl(parts[1].slice(0, -3)).data).toBe("2X");
  });

  it("source 的 src / srcset 与 video poster", () => {
    const { run } = setup({
      assets: {
        "img/p.png": assetOf("P", "image/png"),
        "img/p.webp": assetOf("W", "image/webp"),
        "img/poster.jpg": assetOf("J", "image/jpeg"),
      },
    });
    const out = run(
      `<picture><source srcset="img/p.webp" type="image/webp"><img src="img/p.png"></picture>` +
        `<video poster="img/poster.jpg"></video>`
    );
    expect(attrOf(out.html, "source", "srcset")?.startsWith("data:image/webp;base64,")).toBe(true);
    expect(attrOf(out.html, "video", "poster")?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(out.assets.sort()).toEqual(["img/p.png", "img/p.webp", "img/poster.jpg"]);
  });

  it("无引号属性值会被补上引号（base64 里的 = 不能裸奔）", () => {
    const { run } = setup({ assets: { "img/a.png": assetOf("A") } });
    const out = run(`<img src=img/a.png>`);
    expect(out.html).toMatch(/<img src="data:image\/png;base64,[^"]+">/);
    expect(parse(out.html)).toBeTruthy();
  });

  it("无引号的 srcset 也整条重写成带引号形式", () => {
    // 无引号属性值以空白结尾，所以它只可能有一个候选（描述符写不进来）
    const { run } = setup({ assets: { "img/a.png": assetOf("1X") } });
    const out = run(`<img srcset=img/a.png>`);
    expect(out.html).toMatch(/^<img srcset="data:image\/png;base64,[^"]+">$/);
    expect(out.html).not.toContain("img/a.png");
    expect(decodeDataUrl(attrOf(out.html, "img", "srcset")!).data).toBe("1X");
    expect(out.warnings).toEqual([]);
  });
});

describe("不该动的东西", () => {
  it("data: / http(s) / 协议相对 / blob: / #锚点 保持原样且不报警", () => {
    const { run, readAsset } = setup({});
    const html =
      `<img src="data:image/png;base64,AAAB">` +
      `<img src="https://example.com/a.png">` +
      `<img src="//cdn.example.com/b.png">` +
      `<img src="blob:http://x/1">` +
      `<img src="#top">` +
      `<a href="http://x">x</a>`;
    const out = run(html);
    expect(out.html).toBe(html);
    expect(out.warnings).toEqual([]);
    expect(out.assets).toEqual([]);
    expect(readAsset).not.toHaveBeenCalled();
  });

  it("缺文件：保留原引用 + 明确 warning，不静默丢图", () => {
    const { run } = setup({ assets: {} });
    const out = run(`<img src="img/gone.png">`);
    expect(out.html).toBe(`<img src="img/gone.png">`);
    expect(out.assets).toEqual(["img/gone.png"]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("缺少资源");
    expect(out.warnings[0]).toContain("img/gone.png");
  });

  it("超单文件上限：保留原引用 + warning", () => {
    const { run } = setup({
      assets: { "img/huge.png": assetOf("HUGE", "image/png", MAX_INLINE_ASSET_BYTES + 1) },
    });
    const out = run(`<img src="img/huge.png">`);
    expect(out.html).toBe(`<img src="img/huge.png">`);
    expect(out.warnings[0]).toContain("资源过大");
  });

  it("读资源一方回 too-large 也算超限", () => {
    const { run } = setup({ assets: { "img/huge.png": "too-large" } });
    const out = run(`<img src="img/huge.png">`);
    expect(out.html).toBe(`<img src="img/huge.png">`);
    expect(out.warnings[0]).toContain("资源过大");
  });

  it("本页总量超预算后不再内联，但已内联的不回滚", () => {
    const assets: Record<string, AssetReadResult> = {};
    for (let i = 0; i < 10; i++) {
      assets[`img/${i}.png`] = assetOf(`P${i}`, "image/png", MAX_INLINE_ASSET_BYTES - 1024);
    }
    const { run } = setup({ assets });
    const html = Array.from({ length: 10 }, (_, i) => `<img src="img/${i}.png">`).join("");
    const out = run(html);
    const inlined = (out.html.match(/data:image\/png/g) || []).length;
    expect(inlined).toBeGreaterThan(0);
    expect(inlined).toBeLessThan(10);
    expect(out.warnings.some((w) => w.includes("总量"))).toBe(true);
    expect(MAX_INLINE_TOTAL_BYTES).toBe(12 * 1024 * 1024);
  });

  it("还没取到（pending）不改写也不报警，但列进 assets", () => {
    const { run } = setup({ assets: { "img/a.png": "pending" } });
    const out = run(`<img src="img/a.png">`);
    expect(out.html).toBe(`<img src="img/a.png">`);
    expect(out.warnings).toEqual([]);
    expect(out.assets).toEqual(["img/a.png"]);
  });

  it("不认识的后缀不塞 data URL，说清楚原因", () => {
    const { run } = setup({});
    const out = run(`<img src="docs/a.pdf">`);
    expect(out.html).toBe(`<img src="docs/a.pdf">`);
    expect(out.warnings[0]).toContain("不认识的资源类型");
  });

  it("同一张图被引两次只取一次、只算一次体积", () => {
    const { run, readAsset } = setup({ assets: { "img/a.png": assetOf("A") } });
    const out = run(`<img src="img/a.png"><img src="img/a.png">`);
    expect(readAsset).toHaveBeenCalledTimes(1);
    expect((out.html.match(/data:image\/png/g) || []).length).toBe(2);
  });
});

describe("CSS 里的 url()", () => {
  const CSS = `.hero{background:url(../img/hero.png) no-repeat}
@font-face{font-family:"Brand";src:url(../fonts/brand.woff2) format("woff2")}
.icon{background-image:url("../img/icon.svg")}
/* url(../img/in-comment.png) */
.quote::before{content:"url(../img/in-string.png)"}
.remote{background:url(https://example.com/r.png)}
.embed{background:url(data:image/png;base64,AAAB)}
`;

  function runCss(extraStyles?: Record<string, AssetReadResult>) {
    const { run } = setup({
      text: { "css/style.css": CSS },
      assets: {
        "img/hero.png": assetOf("HERO"),
        "fonts/brand.woff2": assetOf("FONT", "font/woff2"),
        "img/icon.svg": assetOf("SVG", "image/svg+xml"),
        ...extraStyles,
      },
    });
    return run(`<html><head><link rel="stylesheet" href="css/style.css"></head><body>x</body></html>`);
  }

  it("样式表内的相对路径按 CSS 自己的目录解析", () => {
    const out = runCss();
    expect(out.assets).toContain("img/hero.png");
    const css = out.html;
    expect(css).toContain(toDataUrl("image/png", Buffer.from("HERO").toString("base64")));
    expect(css).not.toContain("url(../img/hero.png)");
  });

  it("@font-face 的字体拿到正确 MIME", () => {
    const out = runCss();
    expect(out.html).toContain("data:font/woff2;base64,");
    expect(out.html).toContain('format("woff2")');
  });

  it("注释与字符串里的 url 不动", () => {
    const out = runCss();
    expect(out.html).toContain("/* url(../img/in-comment.png) */");
    expect(out.html).toContain('content:"url(../img/in-string.png)"');
  });

  it("外链与 data: 保持原样", () => {
    const out = runCss();
    expect(out.html).toContain("url(https://example.com/r.png)");
    expect(out.html).toContain("url(data:image/png;base64,AAAB)");
  });

  it("行号不变（样式面板靠行号回索引）", () => {
    const out = runCss();
    const before = CSS.split("\n");
    const after = out.html.slice(out.html.indexOf("<style"));
    const afterCss = after.slice(after.indexOf(">") + 1, after.indexOf("</style>"));
    // 内容被 escapeRawText 处理过（无 < > &），行数必须一致
    expect(afterCss.split("\n").length).toBe(before.length);
    const lines = afterCss.split("\n");
    expect(lines[0].startsWith(".hero{background:url(\"data:image/png")).toBe(true);
    expect(lines[1].startsWith("@font-face{font-family:")).toBe(true);
    expect(lines[2].startsWith(".icon{background-image:url(\"data:image/svg+xml")).toBe(true);
    // 注释行、字符串行、外链行的行号也没挪
    expect(lines[3]).toContain("in-comment");
    expect(lines[4]).toContain("in-string");
    expect(lines[5]).toContain("https://example.com/r.png");
  });

  it("data-lh-inline 来源标记仍然正确（三处细节都不能丢）", () => {
    const { run } = setup({
      text: { "css/style.css": `.a{background:url(img/a.png)}` },
      assets: { "img/a.png": assetOf("A") },
    });
    const out = run(`<link rel="stylesheet" href="css/style.css">`, {
      mapPath: (rel) => `demo/${rel}`,
    });
    expect(out.html).toContain('data-lh-inline="demo/css/style.css"');
  });

  it("页面内 <style> 块的 url 按文档目录解析", () => {
    const { run } = setup({ assets: { "img/bg.png": assetOf("BG") } });
    const out = run(`<style>.page{background:url(img/bg.png)}</style>`, { baseDir: "pages" });
    // pages 目录下没有 img/bg.png（资源表里只有根目录的 img/bg.png）→ 缺文件 + warning
    expect(out.assets).toEqual(["pages/img/bg.png"]);
    expect(out.warnings[0]).toContain("pages/img/bg.png");
  });

  it("页面内 <style> 块命中资源时真的换掉", () => {
    const { run } = setup({ assets: { "pages/img/bg.png": assetOf("BG2") } });
    const out = run(`<style>.page{background:url(img/bg.png)}</style>`, { baseDir: "pages" });
    expect(out.html).toContain('url("data:image/png;base64,');
    expect(out.html).not.toContain("url(img/bg.png)");
    expect(decodeDataUrl(/url\("(data:image\/png;base64,[^"]+)"\)/.exec(out.html)![1]).data).toBe(
      "BG2"
    );
    expect(out.warnings).toEqual([]);
  });

  it("@import 不展平，但单独列出下一期要处理的地方", () => {
    const { run } = setup({
      text: { "css/style.css": `@import url("theme/base.css");\n.a{color:red}` },
    });
    const out = run(`<link rel="stylesheet" href="css/style.css">`);
    expect(out.html).toContain('@import url("theme/base.css")');
    expect(out.warnings.some((w) => w.includes("@import 未展平"))).toBe(true);
  });
});

describe("内联后定位锚点仍然有效", () => {
  const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="css/style.css"></head>
<body><h1>标题</h1><p>正文。</p><img src="img/a.png" alt="图"><button id="go">点我</button><script src="js/app.js"></script></body></html>`;

  it("元素数量与可见文本不变（点击定位靠这两样）", () => {
    const { run } = setup({
      text: { "css/style.css": `.a{background:url(img/bg.png)}`, "js/app.js": "console.log(1)" },
      assets: { "img/a.png": assetOf("A"), "img/bg.png": assetOf("BG") },
    });
    const out = run(PAGE);
    expect(countElements(out.html)).toBe(countElements(PAGE));
    expect(buildHtmlPlainMap(out.html).plain).toBe(buildHtmlPlainMap(PAGE).plain);
    // 脚本 / 样式仍然内联，来源标记还在
    expect(out.html).toContain("data-lh-inline");
  });
});
