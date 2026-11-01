import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildInstrumentedSrcDoc } from "./locate";
import { buildHtmlPlainMap } from "./locate/htmlPlainMap";
import { planProjectImport, isProjectTextPath } from "./importProject";
import { inlineProjectHtml } from "./inlineProject";
import { mimeForAssetPath } from "./projectAssets";

/**
 * 验收示例端到端（examples/资源内联验收）：
 * 真实磁盘文件 → 项目导入规划 → 预览前内联 → 插桩 srcDoc。
 * 断言到「data URL 解出来的字节和磁盘上的文件逐字节相同」，而不是只看前缀。
 */
const DIR = join(process.cwd(), "examples", "资源内联验收");

function walk(rel: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(DIR, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk("");
const TEXT_EXT = /\.(html|css|js)$/i;
const text: Record<string, string> = {};
const diskBytes: Record<string, Buffer> = {};
for (const rel of ALL) {
  if (TEXT_EXT.test(rel)) {
    // 和应用一致：读进来先归一成 LF（Windows 检出是 CRLF，data-lh 的偏移量按 LF 算）
    text[rel] = readFileSync(join(DIR, rel), "utf8").replace(/\r\n/g, "\n");
  } else {
    diskBytes[rel] = readFileSync(join(DIR, rel));
  }
}

function runExample() {
  // 这些用例看的是同一份输出，跑一次就够了（也避免在整套测试里重复堆工作量）
  if (cachedExample) return cachedExample;
  const asset = (rel: string) => {
    const buf = diskBytes[rel];
    if (!buf) return "missing" as const;
    const mime = mimeForAssetPath(rel);
    if (!mime) return "missing" as const;
    return { mime, base64: buf.toString("base64"), bytes: buf.length };
  };
  const warnings = new Set<string>();
  const inline = (html: string) => {
    const result = inlineProjectHtml(html, {
      readFile: (rel) => text[rel] ?? null,
      readAsset: asset,
      mapPath: (rel) => `资源内联验收/${rel}`,
      sourceLabel: "index.html",
    });
    for (const w of result.warnings) warnings.add(w);
    return result.html;
  };
  // 不带插桩的版本：用来核对「可见文本不变」这类纯内容不变量
  const plain = inline(text["index.html"]);
  const srcDoc = buildInstrumentedSrcDoc(text["index.html"], undefined, { inline });
  cachedExample = { srcDoc, plain, warnings };
  return cachedExample;
}

let cachedExample: { srcDoc: string; plain: string; warnings: Set<string> } | null = null;

/** 从 `data:<mime>;base64,<payload>` 还原字节。 */
function decode(url: string): { mime: string; buf: Buffer } {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
  if (!m) throw new Error(`不是 base64 data URL：${url.slice(0, 40)}`);
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

function attrValues(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*?\\s${attr}="([^"]*)"`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

describe("验收示例：examples/资源内联验收", () => {
  it("导入规划：图片 / 字体进 rawBinary，html / css / js 进文档与文本资源", () => {
    const files = ALL.map((rel) =>
      isProjectTextPath(rel)
        ? { path: rel, text: readFileSync(join(DIR, rel), "utf8") }
        : { path: rel, base64: diskBytes[rel].toString("base64") }
    );
    const plan = planProjectImport({ name: "资源内联验收", files });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.meta.entry).toBe("index.html");
    const binary = plan.rawBinary.map((f) => f.path.replace("资源内联验收/", "")).sort();
    expect(binary).toEqual(
      [
        "fonts/DejaVuSansDisplay.ttf",
        "img/hero 背景.png",
        "img/logo.png",
        "img/logo@2x.png",
        "img/photo.webp",
        "img/poster.jpg",
      ].sort()
    );
    // .svg 按「可编辑的矢量源文件」进文档（与导入规则一致）
    expect(plan.docs.map((d) => d.path)).toContain("资源内联验收/img/icon.svg");
    expect(plan.rawText.map((f) => f.path).sort()).toEqual(
      [
        "资源内联验收/css/site.css",
        "资源内联验收/fonts/LICENSE_DEJAVU.txt",
        "资源内联验收/js/main.js",
      ].sort()
    );
  });

  it("img / srcset / picture / poster 的 data URL 与磁盘文件逐字节相同", () => {
    const { srcDoc, warnings } = runExample();

    const [logoSrc] = attrValues(srcDoc, "img", "src");
    expect(decode(logoSrc)).toEqual({ mime: "image/png", buf: diskBytes["img/logo.png"] });

    // srcset 两档：候选各自对应自己的文件，描述符原样
    const [srcset] = attrValues(srcDoc, "img", "srcset");
    const cands = srcset.split(" 1x, ");
    expect(cands).toHaveLength(2);
    expect(cands[1].endsWith(" 2x")).toBe(true);
    expect(decode(cands[0])).toEqual({ mime: "image/png", buf: diskBytes["img/logo.png"] });
    expect(decode(cands[1].slice(0, -3))).toEqual({
      mime: "image/png",
      buf: diskBytes["img/logo@2x.png"],
    });

    const [webp] = attrValues(srcDoc, "source", "srcset");
    expect(decode(webp).mime).toBe("image/webp");
    expect(decode(webp).buf).toEqual(diskBytes["img/photo.webp"]);

    const posters = attrValues(srcDoc, "video", "poster");
    expect(decode(posters[0]).mime).toBe("image/jpeg");
    expect(decode(posters[0]).buf).toEqual(diskBytes["img/poster.jpg"]);

    // 只有故意缺失的那个文件留在原地
    expect([...warnings]).toHaveLength(1);
    expect([...warnings][0]).toContain("img/missing.png");
    expect(srcDoc).toContain('src="img/missing.png"');
    expect(srcDoc).not.toContain('src="img/logo.png"');
    expect(srcDoc).not.toContain('poster="img/poster.jpg"');
  });

  it("CSS 背景图（中文名 + 空格 + 百分号编码）与字体都换成真字节", () => {
    const { srcDoc } = runExample();

    const bg = /url\("(data:image\/png;base64,[^"]+)"\) center/.exec(srcDoc);
    expect(bg).not.toBeNull();
    expect(decode(bg![1]).buf).toEqual(diskBytes["img/hero 背景.png"]);

    const font = /@font-face\s*\{[^}]*src:\s*url\("(data:[^"]+)"\)/.exec(srcDoc);
    expect(font).not.toBeNull();
    const fontDecoded = decode(font![1]);
    expect(fontDecoded.mime).toBe("font/ttf");
    expect(fontDecoded.buf).toEqual(diskBytes["fonts/DejaVuSansDisplay.ttf"]);
    // 真 TTF：sfnt 版本号 0x00010000（证明不是随手拼的字符串）
    expect(fontDecoded.buf.readUInt32BE(0)).toBe(0x00010000);
    // 文件头里能读到 DejaVu 的厂商信息
    expect(fontDecoded.buf.includes(Buffer.from("DejaVu"))).toBe(true);

    // 图标：img 与 CSS 背景两条路径都要通
    const iconUrls = [...srcDoc.matchAll(/url\("(data:image\/svg\+xml;base64,[^"]+)"\)/g)].map(
      (m) => m[1]
    );
    expect(iconUrls.length).toBeGreaterThanOrEqual(1);
    expect(iconUrls[0]).toBeTruthy();
    expect(decode(iconUrls[0]).buf).toEqual(diskBytes["img/icon.svg"]);
    expect(decode(iconUrls[0]).buf.toString("utf8").startsWith("<svg")).toBe(true);
  });

  it("注释 / 字符串 / data: 里的 url 一个字节没动", () => {
    const { srcDoc } = runExample();
    expect(srcDoc).toContain('/* .legacy { background: url("../img/legacy.png"); } */');
    expect(srcDoc).toContain('content: "url(../img/not-asset.png)"');
    // data: 图标原样保留
    expect(srcDoc).toContain(
      'src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci'
    );
  });

  it("CSS 行号不变、可见文本不变（样式面板与点击定位的前提）", () => {
    const { srcDoc, plain } = runExample();
    const cssLines = text["css/site.css"].split("\n");
    const styleStart = srcDoc.indexOf('data-lh-inline="资源内联验收/css/site.css"');
    expect(styleStart).toBeGreaterThan(0);
    const from = srcDoc.indexOf(">", styleStart) + 1;
    const to = srcDoc.indexOf("</style>", from);
    const inlinedLines = srcDoc.slice(from, to).split("\n");
    expect(inlinedLines.length).toBe(cssLines.length);
    // 同一条规则还在同一行
    const lineOf = (needle: string) => inlinedLines.findIndex((l) => l.includes(needle));
    expect(lineOf("@font-face")).toBe(cssLines.findIndex((l) => l.includes("@font-face")));
    expect(lineOf(".hero {")).toBeGreaterThan(-1);
    expect(lineOf("url(../img/not-asset.png)")).toBe(
      cssLines.findIndex((l) => l.includes("url(../img/not-asset.png)"))
    );

    // 内联（未插桩）后可见文本逐字不变；插桩版只会多一个收尾换行
    expect(buildHtmlPlainMap(plain).plain).toBe(buildHtmlPlainMap(text["index.html"]).plain);
    expect(buildHtmlPlainMap(srcDoc).plain.trimEnd()).toBe(
      buildHtmlPlainMap(text["index.html"]).plain.trimEnd()
    );
  });

  it("插桩锚点仍然指向原始源码（内联只改属性值与 url 载荷）", () => {
    const { srcDoc } = runExample();
    expect(srcDoc).toMatch(/<img class="logo"[^>]*data-lh="508-605"/);
    expect(srcDoc).toContain('data-lh-inline="资源内联验收/css/site.css"');
    expect(srcDoc).toContain('data-lh-inline="资源内联验收/js/main.js"');
    // 脚本也内联了，执行占位还在（浏览器里会被改成「脚本已执行」）
    expect(srcDoc).toContain("脚本占位");
  });
});
