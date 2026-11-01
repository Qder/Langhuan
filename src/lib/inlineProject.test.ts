import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "parse5";
import { buildHtmlPlainMap } from "./locate/htmlPlainMap";
import { buildInstrumentedSrcDoc } from "./locate";
import { planProjectImport } from "./importProject";
import {
  collectExternalRefs,
  inlineProjectHtml,
  joinProjectPath,
  resolveProjectRef,
} from "./inlineProject";

function reader(files: Record<string, string>) {
  return (path: string) => files[path] ?? null;
}

/** 元素节点数（用于「内联前后 DOM 结构一致」断言）。 */
function countElements(html: string): number {
  let n = 0;
  const walk = (node: { tagName?: string; childNodes?: unknown[] }) => {
    if (node.tagName) n += 1;
    for (const child of node.childNodes || []) walk(child as { childNodes?: unknown[] });
  };
  walk(parse(html) as unknown as { childNodes?: unknown[] });
  return n;
}

/** 可见文本（定位算法认的那份）。 */
function visibleText(html: string): string {
  return buildHtmlPlainMap(html).plain;
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>示例</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>标题</h1>
  <p>正文一段。</p>
  <button id="go">点我</button>
  <script src="js/app.js"></script>
</body>
</html>
`;

describe("joinProjectPath", () => {
  it("解析 ./ 与 ../，并夹住越界", () => {
    expect(joinProjectPath("", "css/style.css")).toBe("css/style.css");
    expect(joinProjectPath("pages", "../css/style.css")).toBe("css/style.css");
    expect(joinProjectPath("pages/deep", "./a/b.css")).toBe("pages/deep/a/b.css");
    expect(joinProjectPath("", "../../x.css")).toBe("x.css");
  });

  it("去掉查询串与锚点", () => {
    expect(joinProjectPath("", "css/style.css?v=2#x")).toBe("css/style.css");
  });
});

describe("resolveProjectRef", () => {
  it("相对路径 → 项目内路径", () => {
    expect(resolveProjectRef("js/app.js", "pages")).toEqual({
      kind: "internal",
      path: "pages/js/app.js",
    });
  });

  it("http(s) / 协议相对 → 外链", () => {
    expect(resolveProjectRef("https://cdn.x.com/a.css", "")).toEqual({
      kind: "external",
      url: "https://cdn.x.com/a.css",
    });
    expect(resolveProjectRef("//cdn.x.com/a.js", "")).toEqual({
      kind: "external",
      url: "//cdn.x.com/a.js",
    });
  });

  it("data: / 锚点 → 忽略", () => {
    expect(resolveProjectRef("data:text/css,a{}", "").kind).toBe("skip");
    expect(resolveProjectRef("#top", "").kind).toBe("skip");
  });
});

describe("inlineProjectHtml", () => {
  it("内联相对路径的样式与脚本", () => {
    const res = inlineProjectHtml(PAGE, {
      readFile: reader({
        "css/style.css": "body{color:#333}",
        "js/app.js": "document.title='ok';",
      }),
    });
    expect(res.inlined).toEqual(["css/style.css", "js/app.js"]);
    expect(res.external).toEqual([]);
    expect(res.missing).toEqual([]);
    expect(res.html).toContain("<style data-lh-inline=\"css/style.css\">body{color:#333}</style>");
    expect(res.html).toContain('<script data-lh-inline="js/app.js">document.title=\'ok\';</script>');
    expect(res.html).not.toContain('href="css/style.css"');
    expect(res.html).not.toContain('src="js/app.js"');
    expect(res.html).not.toContain("</script></script>");
    // 元素个数与可见文本不变（定位依赖）
    expect(countElements(res.html)).toBe(countElements(PAGE));
    expect(visibleText(res.html)).toBe(visibleText(PAGE));
  });

  it("mapPath 把 data-lh-inline 换成库内路径（样式面板靠它认文件）", () => {
    const res = inlineProjectHtml(PAGE, {
      readFile: reader({
        "css/style.css": "body{color:#333}",
        "js/app.js": "document.title='ok';",
      }),
      mapPath: (rel) => `项目示例/${rel}`,
    });
    expect(res.html).toContain('data-lh-inline="项目示例/css/style.css"');
    expect(res.html).toContain('data-lh-inline="项目示例/js/app.js"');
    // inlined/missing 仍按项目内路径报告，不受影响
    expect(res.inlined).toEqual(["css/style.css", "js/app.js"]);
  });

  it("带目录的页面按自身目录解析相对路径", () => {
    const html = `<html><head><link rel="stylesheet" href="../css/style.css"></head><body><p>hi</p></body></html>`;
    const res = inlineProjectHtml(html, {
      baseDir: "pages",
      readFile: reader({ "css/style.css": "p{color:red}" }),
    });
    expect(res.inlined).toEqual(["css/style.css"]);
    expect(res.html).toContain("p{color:red}");
  });

  it("外链跳过但记录，标签保持原样", () => {
    const html = `<html><head>
<link rel="stylesheet" href="https://cdn.x.com/a.css">
<link rel="stylesheet" href="//cdn.x.com/b.css">
<link rel="stylesheet" href="local.css">
</head><body></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({ "local.css": ".a{}" }) });
    expect(res.external).toEqual(["https://cdn.x.com/a.css", "//cdn.x.com/b.css"]);
    expect(res.inlined).toEqual(["local.css"]);
    expect(res.html).toContain('href="https://cdn.x.com/a.css"');
    expect(res.html).toContain('href="//cdn.x.com/b.css"');
  });

  it("<base href> 为相对路径时按 base 解析", () => {
    const html = `<html><head><base href="assets/"><link rel="stylesheet" href="theme.css"></head><body></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({ "assets/theme.css": ":root{}" }) });
    expect(res.inlined).toEqual(["assets/theme.css"]);
    expect(res.html).toContain(":root{}");
  });

  it("<base href> 为外站时，相对引用算外链且不内联", () => {
    const html = `<html><head><base href="https://cdn.x.com/v1/"><link rel="stylesheet" href="theme.css"></head><body></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({ "theme.css": ":root{}" }) });
    expect(res.inlined).toEqual([]);
    expect(res.external).toEqual(["https://cdn.x.com/v1/theme.css"]);
    expect(res.html).not.toContain(":root{}");
  });

  it("项目里没有的文件保持原标签并记录", () => {
    const html = `<html><head><link rel="stylesheet" href="missing.css"></head><body></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({}) });
    expect(res.missing).toEqual(["missing.css"]);
    expect(res.html).toContain('<link rel="stylesheet" href="missing.css">');
  });

  it("保留 media/type 等属性，丢掉 src/integrity", () => {
    const html = `<html><head><link rel="stylesheet" media="print" href="p.css"></head><body><script src="m.js" type="module" defer integrity="sha384-x"></script></body></html>`;
    const res = inlineProjectHtml(html, {
      readFile: reader({ "p.css": ".p{}", "m.js": "export const a=1;" }),
    });
    expect(res.html).toContain('media="print"');
    expect(res.html).toContain('type="module"');
    expect(res.html).not.toContain("integrity=");
    expect(res.html).not.toContain("defer");
  });

  it("非样式 link 不动", () => {
    const html = `<html><head><link rel="preload" href="x.woff2" as="font"></head><body></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({ "x.woff2": "bin" }) });
    expect(res.inlined).toEqual([]);
    expect(res.html).toContain('rel="preload"');
  });

  it("脚本内容里的 </script> 被转义，不会截断", () => {
    const html = `<html><body><script src="a.js"></script></body></html>`;
    const res = inlineProjectHtml(html, {
      readFile: reader({ "a.js": "var s='</script>';" }),
    });
    expect(res.html).toContain("<\\/script>");
    expect(res.html.split("</script>").length - 1).toBe(1);
  });

  it("注释与 JS 字符串里的假标签不误伤", () => {
    const html = `<html><body><!-- <link rel="stylesheet" href="ghost.css"> --><script>var t='<script src="x.js">';</script></body></html>`;
    const res = inlineProjectHtml(html, { readFile: reader({ "ghost.css": "x", "x.js": "y" }) });
    expect(res.inlined).toEqual([]);
    expect(res.html).toContain("ghost.css");
  });
});

describe("collectExternalRefs", () => {
  it("去重且只收集外链", () => {
    const html = `<html><head>
<link rel="stylesheet" href="https://a.com/1.css">
<link rel="stylesheet" href="https://a.com/1.css">
<link rel="stylesheet" href="local.css">
<script src="https://b.com/2.js"></script>
</head><body></body></html>`;
    expect(collectExternalRefs(html)).toEqual(["https://a.com/1.css", "https://b.com/2.js"]);
  });
});

/**
 * 用仓库里的 examples/项目示例 走一遍真实链路：
 * 规划导入 → 预览前内联 → 插桩 srcDoc（定位锚点仍在）。
 */
describe("示例项目端到端（examples/项目示例）", () => {
  const dir = join(process.cwd(), "examples", "项目示例");
  const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
  const picked = [
    { path: "index.html", text: read("index.html") },
    { path: "about.html", text: read("about.html") },
    { path: "css/style.css", text: read("css/style.css") },
    { path: "js/app.js", text: read("js/app.js") },
  ];

  it("识别入口并拆出文档 / 资源", () => {
    const plan = planProjectImport({ name: "项目示例", files: picked });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.meta.entry).toBe("index.html");
    expect(plan.meta.files).toEqual([
      "about.html",
      "css/style.css",
      "index.html",
      "js/app.js",
    ]);
    expect(plan.docs.map((d) => d.path)).toEqual([
      "项目示例/index.html",
      "项目示例/about.html",
    ]);
    expect(plan.rawText.map((f) => f.path)).toEqual([
      "项目示例/css/style.css",
      "项目示例/js/app.js",
    ]);
  });

  it("预览 srcDoc 已内联样式与脚本，且保留定位锚点", () => {
    const plan = planProjectImport({ name: "项目示例", files: picked });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const prefix = `${plan.root}/`;
    const map: Record<string, string> = {};
    for (const f of plan.rawText) map[f.path.slice(prefix.length)] = f.content;
    const entry = plan.docs.find((d) => d.path.endsWith("/index.html"));
    expect(entry).toBeTruthy();

    const srcDoc = buildInstrumentedSrcDoc(entry!.content, undefined, {
      inline: (html) =>
        inlineProjectHtml(html, { readFile: (rel) => map[rel] ?? null }).html,
    });

    // 样式/脚本内容进来了，原始引用被替换
    expect(srcDoc).toContain("--accent:");
    expect(srcDoc).toContain("addEventListener");
    expect(srcDoc).not.toContain('href="css/style.css"');
    expect(srcDoc).not.toContain('src="js/app.js"');
    // 插桩先于内联：data-lh 仍指向原始源码
    expect(srcDoc).toMatch(/data-lh="\d+-\d+"/);
    // 可见文本没变（定位算法的前提）
    expect(buildHtmlPlainMap(srcDoc).plain).toContain("点我改文字");
  });
});
