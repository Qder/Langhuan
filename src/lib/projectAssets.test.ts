import { describe, expect, it } from "vitest";
import {
  MAX_INLINE_ASSET_BYTES,
  decodeCssUrl,
  extOf,
  formatBytes,
  mimeForAssetPath,
  parseSrcset,
  scanCssUrls,
  toDataUrl,
} from "./projectAssets";

describe("mimeForAssetPath", () => {
  it("覆盖图片 / 图标 / 字体", () => {
    expect(mimeForAssetPath("img/a.png")).toBe("image/png");
    expect(mimeForAssetPath("img/a.JPG")).toBe("image/jpeg");
    expect(mimeForAssetPath("img/a.jpeg")).toBe("image/jpeg");
    expect(mimeForAssetPath("img/a.gif")).toBe("image/gif");
    expect(mimeForAssetPath("img/a.webp")).toBe("image/webp");
    expect(mimeForAssetPath("img/icon.svg")).toBe("image/svg+xml");
    expect(mimeForAssetPath("favicon.ico")).toBe("image/x-icon");
    expect(mimeForAssetPath("img/a.avif")).toBe("image/avif");
    expect(mimeForAssetPath("fonts/a.woff")).toBe("font/woff");
    expect(mimeForAssetPath("fonts/a.woff2")).toBe("font/woff2");
    expect(mimeForAssetPath("fonts/a.ttf")).toBe("font/ttf");
    expect(mimeForAssetPath("fonts/a.otf")).toBe("font/otf");
  });

  it("不认识的类型返回 null（不硬塞 data URL）", () => {
    expect(mimeForAssetPath("data/a.csv")).toBeNull();
    expect(mimeForAssetPath("noext")).toBeNull();
    expect(mimeForAssetPath("a.")).toBeNull();
  });

  it("查询串 / 锚点不影响扩展名判断", () => {
    expect(mimeForAssetPath("img/a.png?v=2#x")).toBe("image/png");
  });
});

describe("extOf", () => {
  it("取最后一段扩展名", () => {
    expect(extOf("a/b/c.PNG")).toBe("png");
    expect(extOf("a/b/c")).toBe("");
    expect(extOf(".gitkeep")).toBe("");
  });
});

describe("formatBytes", () => {
  it("按量级给单位", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(24 * 1024 * 1024)).toBe("24 MB");
  });
});

describe("toDataUrl", () => {
  it("拼标准 data URL", () => {
    expect(toDataUrl("image/png", "AA==")).toBe("data:image/png;base64,AA==");
  });
});

describe("parseSrcset", () => {
  it("多候选 + 描述符，位置准确", () => {
    const value = "img/a.png 1x, img/a@2x.png 2x";
    const cands = parseSrcset(value);
    expect(cands.map((c) => [c.url, c.descriptor])).toEqual([
      ["img/a.png", "1x"],
      ["img/a@2x.png", "2x"],
    ]);
    for (const c of cands) expect(value.slice(c.start, c.end)).toBe(c.url);
  });

  it("宽度描述符与无描述符混用", () => {
    const cands = parseSrcset("a.png,a2.png 640w");
    // 没有空格的逗号：浏览器把整个 token 当 URL，我们保持同样的解析结果
    expect(cands).toHaveLength(1);
    expect(cands[0].url).toBe("a.png,a2.png");
  });

  it("data URL 里的逗号不会被当成分隔符", () => {
    const value = "data:image/png;base64,AAAB 1x, img/b.png 2x";
    const cands = parseSrcset(value);
    expect(cands.map((c) => c.url)).toEqual(["data:image/png;base64,AAAB", "img/b.png"]);
  });

  it("逗号 + 空格分隔时正确切分", () => {
    const cands = parseSrcset("a.png 1x, b.png 2x, c.png 3x");
    expect(cands.map((c) => c.url)).toEqual(["a.png", "b.png", "c.png"]);
  });
});

describe("scanCssUrls", () => {
  it("引号 / 无引号 url() 都给载荷区间", () => {
    const css = `a{background:url("img/a.png")}b{background:url(img/b.png)}`;
    const { urls } = scanCssUrls(css);
    expect(urls.map((u) => u.raw)).toEqual(["img/a.png", "img/b.png"]);
    expect(urls.map((u) => u.quote)).toEqual(['"', ""]);
    for (const u of urls) expect(css.slice(u.start, u.end)).toBe(u.raw);
  });

  it("注释与字符串里的 url 不算", () => {
    const css = `/* url(img/comment.png) */\na{content:"url(img/str.png)"}\nb{background:url(img/real.png)}`;
    const { urls } = scanCssUrls(css);
    expect(urls.map((u) => u.raw)).toEqual(["img/real.png"]);
  });

  it("@import 单独列出且不算可改写 url", () => {
    const css = `@import url("theme/base.css");\n@font-face{src:url(../fonts/a.woff2) format("woff2")}`;
    const { urls, imports } = scanCssUrls(css);
    expect(imports).toEqual(["theme/base.css"]);
    expect(urls.map((u) => u.raw)).toEqual(["../fonts/a.woff2"]);
  });

  it("@import \"x.css\" 写法也认", () => {
    const { imports } = scanCssUrls(`@import "a.css";`);
    expect(imports).toEqual(["a.css"]);
  });

  it("转义括号不会提前结束", () => {
    const css = `a{background:url(img/a\\)b.png)}`;
    const { urls } = scanCssUrls(css);
    expect(urls.map((u) => u.raw)).toEqual(["img/a\\)b.png"]);
  });

  it("大小写不敏感", () => {
    const { urls } = scanCssUrls(`a{background:URL(img/a.png)}`);
    expect(urls.map((u) => u.raw)).toEqual(["img/a.png"]);
  });

  it("给 postcss 当标准答案交叉验证：不漏、不多", async () => {
    // 这份语料只用「一套正则就能读懂」的写法，这样 postcss 那边的对照也可靠：
    // 注释、@import、@media、@font-face 多 src、data URL、单双引号。
    const css = `@import url("theme/base.css");
/* url(img/in-comment.png) */
.hero{background:#fff url('../img/hero 2x.png') no-repeat}
.icon{background:url(data:image/png;base64,AAAB)}
@media (min-width:640px){.m{background-image:url("img/m.png")}}
@font-face{font-family:"X";src:url(../fonts/x.woff2) format("woff2"),url(../fonts/x.woff) format("woff")}
.plain{color:red}
`;
    const { urls, imports } = scanCssUrls(css);
    const mine = urls.map((u) => decodeCssUrl(u.raw)).sort();

    const mod = await import("postcss");
    const postcss = (mod as { default?: unknown }).default ?? mod;
    const root = (
      postcss as {
        parse: (
          s: string,
          o?: unknown
        ) => {
          walkDecls: (cb: (d: { value: string }) => void) => void;
          walkAtRules: (name: string, cb: (r: { params: string }) => void) => void;
        };
      }
    ).parse(css);
    const theirs: string[] = [];
    root.walkDecls((decl) => {
      const re = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(decl.value))) theirs.push(decodeCssUrl(m[2]));
    });
    expect(mine).toEqual(theirs.sort());

    // @import 的引用也要和 postcss 的 at-rule 参数对齐
    const oracleImports: string[] = [];
    root.walkAtRules("import", (rule) => {
      const m = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/i.exec(rule.params);
      oracleImports.push(m ? m[2] : rule.params.trim());
    });
    expect(imports).toEqual(oracleImports);
  });
});

describe("decodeCssUrl", () => {
  it("解十六进制与字符转义", () => {
    expect(decodeCssUrl("img/a\\ b.png")).toBe("img/a b.png");
    expect(decodeCssUrl("img/\\31 0.png")).toBe("img/10.png");
    expect(decodeCssUrl("img/a.png")).toBe("img/a.png");
  });
});

describe("限额常量", () => {
  it("单文件上限明确且小于导入上限", () => {
    expect(MAX_INLINE_ASSET_BYTES).toBe(1.5 * 1024 * 1024);
    expect(MAX_INLINE_ASSET_BYTES).toBeLessThan(8 * 1024 * 1024);
  });
});
