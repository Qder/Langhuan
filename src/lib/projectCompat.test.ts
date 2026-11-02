import { describe, expect, it } from "vitest";
import { analyzeProjectCompat,
  compatIssueJumpTarget,
  rangeForSourceLine, type CompatReport } from "./projectCompat";

/** `#bin` 表示「这个文件存在，但不是文本」（图片 / 字体）。 */
type Fixture = Record<string, string | "#bin">;

function analyze(html: string, extra: Fixture = {}, opts?: { oversized?: string[] }): CompatReport {
  const text: Record<string, string> = {};
  for (const [rel, value] of Object.entries(extra)) {
    if (value !== "#bin") text[rel] = value;
  }
  return analyzeProjectCompat({
    html,
    htmlPath: "demo/index.html",
    files: ["index.html", ...Object.keys(extra)],
    readText: (rel) => text[rel] ?? null,
    mapPath: (rel) => `demo/${rel}`,
    oversized: opts?.oversized,
  });
}

function kinds(report: CompatReport): string[] {
  return report.issues.map((i) => i.kind);
}

describe("analyzeProjectCompat", () => {
  it("普通 HTML / CSS / JS 项目：一条都不报", () => {
    const report = analyze(
      `<!doctype html>
<html><head>
  <link rel="stylesheet" href="css/site.css">
  <script src="js/app.js"></script>
</head><body>
  <h1>普通页面</h1>
  <img src="img/a.png" alt="">
</body></html>`,
      {
        "css/site.css": "body { margin: 0 }\n.hero { background: url(../img/a.png) }\n",
        "js/app.js": 'document.querySelector("h1").textContent = "改过";\n',
        "img/a.png": "#bin",
      }
    );
    expect(report.issues).toEqual([]);
    expect(report.groups).toEqual([]);
    expect(report.total).toBe(0);
  });

  it("module + 相对 import：报在 js 文件那一行，并说明源码定位仍可用", () => {
    const report = analyze(
      `<script type="module" src="js/app.js"></script>`,
      {
        "js/app.js": `// 入口
import { count } from "./counter.js";
export const total = count + 1;
`,
        "js/counter.js": "export const count = 1;\n",
      }
    );
    expect(kinds(report)).toEqual(["module-relative-import"]);
    const issue = report.issues[0];
    expect(issue.file).toBe("demo/js/app.js");
    expect(issue.line).toBe(2);
    expect(issue.target).toBe("./counter.js");
    expect(issue.impact).toBe("可能不运行");
    expect(issue.message).toContain("预览可能不完整");
    expect(issue.message).toContain("源码定位仍可使用");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].title).toContain("ES 模块导入");
  });

  it("module 但没有 import / export-from：不报（模块本身能跑）", () => {
    const report = analyze(`<script type="module" src="js/app.js"></script>`, {
      "js/app.js": `export const answer = 42;
document.body.dataset.ready = String(answer);
`,
    });
    expect(report.total).toBe(0);
  });

  it("head 里的 defer 脚本：如实说「属性会被去掉」，不是「已保留」", () => {
    const report = analyze(
      `<html><head><script src="js/app.js" defer></script></head><body></body></html>`,
      { "js/app.js": "init();\n" }
    );
    expect(kinds(report)).toEqual(["defer-async"]);
    const issue = report.issues[0];
    expect(issue.line).toBe(1);
    expect(issue.impact).toBe("执行时机可能改变");
    expect(issue.message).toContain("会被去掉");
    expect(issue.message).toContain("同步执行");
    expect(issue.message).not.toContain("已保留");
    expect(issue.message).not.toContain("完全支持");
  });

  it("async 脚本：措辞跟着属性走", () => {
    const report = analyze(`<script src="js/late.js" async></script>`, {
      "js/late.js": "load();\n",
    });
    expect(kinds(report)).toEqual(["defer-async"]);
    expect(report.issues[0].message).toContain("async");
    expect(report.issues[0].message).toContain("会被去掉");
  });

  it("外链脚本的 defer：说明标签保留、但相对顺序可能变", () => {
    const report = analyze(
      `<script src="https://cdn.example.com/lib.js" defer></script>`,
      {}
    );
    expect(kinds(report)).toEqual(["defer-async", "network-dependency"]);
    const defer = report.issues.find((i) => i.kind === "defer-async");
    expect(defer?.message).toContain("原样保留");
    expect(defer?.message).toContain("先后顺序");
  });

  it("CDN 与本地缺失同时存在：分类汇总，各自带文件与影响", () => {
    const report = analyze(
      `<html><head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/site/site.css">
  <script src="js/missing.js"></script>
</head><body>
  <img src="img/gone.png" alt="">
</body></html>`,
      {}
    );
    expect(report.total).toBe(3);
    expect(kinds(report)).toEqual(["network-dependency", "missing-resource", "missing-resource"]);
    expect(report.groups.map((g) => g.kind)).toEqual([
      "network-dependency",
      "missing-resource",
    ]);

    const net = report.issues.find((i) => i.kind === "network-dependency");
    expect(net?.target).toBe("https://cdn.jsdelivr.net/npm/site/site.css");
    expect(net?.impact).toBe("需要联网");
    expect(net?.message).toContain("需要联网");

    const missing = report.issues.filter((i) => i.kind === "missing-resource");
    expect(missing.map((i) => i.target).sort()).toEqual(["img/gone.png", "js/missing.js"]);
    const js = missing.find((i) => i.target === "js/missing.js");
    const img = missing.find((i) => i.target === "img/gone.png");
    expect(js?.impact).toBe("无法定位");
    expect(js?.message).toContain("行为面板");
    expect(img?.impact).toBe("预览会失真");
    // 组的影响取「最严重」的那条：脚本都没了，比少一张图严重
    expect(report.groups[1].impact).toBe("无法定位");
  });

  it("多项问题去重：同一 CDN、同一缺文件被引多次只报一次", () => {
    const report = analyze(
      `<html><head>
  <link rel="stylesheet" href="https://cdn.example.com/a.css">
  <link rel="stylesheet" href="https://cdn.example.com/a.css">
  <script src="https://cdn.example.com/a.css"></script>
</head><body>
  <img src="img/gone.png"><img src="img/gone.png">
</body></html>`,
      {}
    );
    expect(report.total).toBe(2);
    expect(kinds(report)).toEqual(["network-dependency", "missing-resource"]);
  });

  it("内联 module 脚本里的相对 import：行号按 HTML 算，不是脚本内相对行", () => {
    const html = `<html>
<body>
<script type="module">
import { a } from "./a.js";
a();
</script>
</body></html>`;
    const report = analyze(html, { "a.js": "export const a = () => {};\n" });
    expect(kinds(report)).toEqual(["module-relative-import"]);
    expect(report.issues[0].line).toBe(4);
    expect(report.issues[0].file).toBe("demo/index.html");
  });

  it("裸模块名与字面量 / 非字面量动态 import 分开报", () => {
    const report = analyze(`<script type="module" src="js/app.js"></script>`, {
      "js/app.js": `import { createApp } from "vue";
const page = location.hash.slice(2);
import("./pages/home.js");
import(\`./pages/\${page}.js\`);
`,
    });
    expect(kinds(report)).toEqual([
      "module-relative-import",
      "module-bare-import",
      "dynamic-module-load",
    ]);
    const bare = report.issues.find((i) => i.kind === "module-bare-import");
    const relative = report.issues.find((i) => i.kind === "module-relative-import");
    const dynamic = report.issues.find((i) => i.kind === "dynamic-module-load");
    expect(bare?.target).toBe("vue");
    expect(bare?.message).toContain("import map");
    expect(relative?.target).toBe("./pages/home.js");
    expect(relative?.line).toBe(3);
    expect(dynamic?.message).toContain("运行时");
    expect(dynamic?.line).toBe(4);
  });

  it("没写 type=module 却用了 import：说是语法错误、整段不执行", () => {
    const report = analyze(`<script src="js/app.js"></script>`, {
      "js/app.js": `import { x } from "./x.js";
`,
    });
    expect(kinds(report)).toEqual(["module-relative-import"]);
    expect(report.issues[0].message).toContain('type="module"');
    expect(report.issues[0].message).toContain("语法错误");
  });

  it("CSS 里的 @import 与 url()：本地可展平不报；缺失 / 外站分别归口", () => {
    const report = analyze(
      `<link rel="stylesheet" href="css/site.css">`,
      {
        "css/site.css": `@import "theme/base.css";
@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+SC");
.hero { background: url("../img/hero.png") }
.logo { background: url("../img/logo.svg") }
`,
        "css/theme/base.css": "body { color: #333 }\n",
        "img/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>\n",
      }
    );
    expect(kinds(report)).toEqual([
      "network-dependency",
      "missing-resource",
    ]);
    expect(report.issues.find((i) => i.target === "css/theme/base.css")).toBeUndefined();
    const missing = report.issues.find((i) => i.kind === "missing-resource");
    expect(missing?.target).toBe("img/hero.png");
    expect(missing?.line).toBe(3);
    // 字体 / 图标的 url() 也在同一份 CSS 里，但它们都存在 → 不报
    expect(report.issues.filter((i) => i.target === "img/logo.svg")).toHaveLength(0);
  });

  it("@import 指向不存在的本地文件：报告含「找不到」", () => {
    const report = analyze(`<link rel="stylesheet" href="css/site.css">`, {
      "css/site.css": `@import "./theme/nope.css";\n`,
    });
    expect(kinds(report)).toEqual(["missing-resource"]);
    expect(report.issues[0].message).toContain("找不到");
    expect(report.issues[0].target).toBe("css/theme/nope.css");
  });

  it("资源太大 / 全页超上限：报「没能进预览」，并给出原因", () => {
    const report = analyze(`<img src="img/big.png"><img src="img/huge.png">`, {
      "img/big.png": "#bin",
      "img/huge.png": "#bin",
    });
    expect(report.total).toBe(0);

    const withState = analyzeProjectCompat({
      html: `<img src="img/big.png"><img src="img/huge.png">`,
      htmlPath: "demo/index.html",
      files: ["index.html", "img/big.png", "img/huge.png"],
      readText: () => null,
      mapPath: (rel) => `demo/${rel}`,
      oversized: ["img/big.png"],
      budgetDropped: ["img/huge.png"],
    });
    expect(withState.total).toBe(2);
    const big = withState.issues.find((i) => i.target === "img/big.png");
    const huge = withState.issues.find((i) => i.target === "img/huge.png");
    expect(big?.message).toContain("1.5MB");
    expect(huge?.message).toContain("12MB");
  });

  it("不认识的资源类型：报「不会内联」，不报缺文件", () => {
    const report = analyze(`<img src="img/art.pxif">`, { "img/art.pxif": "#bin" });
    expect(kinds(report)).toEqual(["inline-degraded"]);
    expect(report.issues[0].target).toBe("img/art.pxif");
  });

  it("报告按类型顺序排好，行号从 1 开始", () => {
    const report = analyze(
      `<link rel="stylesheet" href="https://cdn.example.com/a.css">
<script type="module" src="js/app.js"></script>
<img src="img/gone.png">`,
      { "js/app.js": `import "./x.js";\n` }
    );
    expect(kinds(report)).toEqual([
      "module-relative-import",
      "network-dependency",
      "missing-resource",
    ]);
    for (const issue of report.issues) expect(issue.line).toBeGreaterThanOrEqual(1);
  });
});


describe("compatIssueJumpTarget + rangeForSourceLine", () => {
  it("maps file+line and omits missing line", () => {
    expect(
      compatIssueJumpTarget({
        kind: "module-relative-import",
        file: "demo/js/module-app.js",
        line: 3,
        target: "./greet.js",
        impact: "可能不运行",
        message: "相对 import",
      })
    ).toEqual({ file: "demo/js/module-app.js", line: 3 });
    expect(
      compatIssueJumpTarget({
        kind: "missing-resource",
        file: "demo/a.js",
        target: "x",
        impact: "预览会失真",
        message: "m",
      })?.line
    ).toBeUndefined();
  });

  it("rangeForSourceLine aligns to 1-based line text", () => {
    const src = "line1\nimport { greet } from \"./greet.js\";\nline3\n";
    const r = rangeForSourceLine(src, 2);
    expect(src.slice(r.start, r.end)).toBe('import { greet } from "./greet.js";');
    expect(rangeForSourceLine(src, 1).start).toBe(0);
  });
});
