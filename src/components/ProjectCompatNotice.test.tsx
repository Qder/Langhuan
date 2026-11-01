// @vitest-environment jsdom
/**
 * 兼容性提示条的静态渲染断言（不点按钮、不跑真浏览器）：
 * 无问题不出现、有问题时「类型 + 文件 + 解释」都读得到、并且不遮挡预览、不抢抽屉的语义。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectCompatNotice } from "./ProjectCompatNotice";
import { analyzeProjectCompat, type CompatReport } from "@/lib/projectCompat";

function reportOf(issues: CompatReport["issues"]): CompatReport {
  const groups: CompatReport["groups"] = [];
  for (const kind of [
    "module-relative-import",
    "module-bare-import",
    "dynamic-module-load",
    "defer-async",
    "network-dependency",
    "missing-resource",
    "inline-degraded",
  ] as const) {
    const items = issues.filter((i) => i.kind === kind);
    if (!items.length) continue;
    groups.push({
      kind,
      title: {
        "module-relative-import": "ES 模块导入（相对路径）",
        "module-bare-import": "ES 模块导入（裸模块名）",
        "dynamic-module-load": "运行时才确定的模块加载",
        "defer-async": "脚本的 defer / async",
        "network-dependency": "外站资源（需要联网）",
        "missing-resource": "找不到的本地文件",
        "inline-degraded": "没能进预览的样式或资源",
      }[kind],
      impact: items[0].impact,
      items,
    });
  }
  return { issues, groups, total: issues.length };
}

const ONE_ISSUE = reportOf([
  {
    kind: "module-relative-import",
    file: "demo/index.html",
    line: 3,
    target: "./app.js",
    impact: "可能不运行",
    message:
      "模块脚本 import 了相对路径「./app.js」。预览没有真实网址可解析，这段模块加载不了 —— 预览可能不完整，源码定位仍可使用。",
  },
]);

const THREE_ISSUES = reportOf([
  {
    kind: "defer-async",
    file: "demo/index.html",
    line: 5,
    target: "js/app.js",
    impact: "执行时机可能改变",
    message: "这个脚本带 defer，但内联进预览时 defer 会被去掉（属性不再保留）。",
  },
  {
    kind: "network-dependency",
    file: "demo/index.html",
    line: 6,
    target: "https://cdn.example.com/a.css",
    impact: "需要联网",
    message: "样式表来自外站（cdn.example.com）。预览会保留这个外链、不下载快照，需要联网才能加载。",
  },
  {
    kind: "missing-resource",
    file: "demo/index.html",
    line: 9,
    target: "img/gone.png",
    impact: "预览会失真",
    message: "引用了 img/gone.png，但项目里没有这个文件。",
  },
]);

describe("ProjectCompatNotice", () => {
  it("没有问题时什么都不渲染", () => {
    const html = renderToStaticMarkup(
      <ProjectCompatNotice report={{ issues: [], groups: [], total: 0 }} />
    );
    expect(html).toBe("");
  });

  it("有问题时先给一行摘要，可展开", () => {
    const html = renderToStaticMarkup(<ProjectCompatNotice report={ONE_ISSUE} />);
    expect(html).toContain("预览可能不完整");
    expect(html).toContain("1 类 1 处");
    expect(html).toContain("展开");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls");
    // 收起时不应该把逐条清单铺开
    expect(html).not.toContain("模块脚本 import 了相对路径");
  });

  it("展开后类型、文件行号、解释、影响都读得到", () => {
    const html = renderToStaticMarkup(<ProjectCompatNotice report={ONE_ISSUE} defaultOpen />);
    expect(html).toContain("收起");
    expect(html).toContain("ES 模块导入（相对路径）");
    expect(html).toContain("demo/index.html:3");
    expect(html).toContain("可能不运行");
    expect(html).toContain("源码定位仍可使用");
    expect(html).toContain("源文件一个字节都没有被改动");
  });

  it("多组问题在摘要里按类汇总，不是并列多条提示", () => {
    const html = renderToStaticMarkup(<ProjectCompatNotice report={THREE_ISSUES} defaultOpen />);
    expect(html).toContain("3 类 3 处");
    expect(html).toContain("脚本的 defer / async");
    expect(html).toContain("外站资源（需要联网）");
    expect(html).toContain("找不到的本地文件");
    // 一个横条：只有一个按钮（展开 / 收起），没有一堆 toast 容器
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("在流内，不遮挡预览、不抢元素检视抽屉的语义", () => {
    const html = renderToStaticMarkup(<ProjectCompatNotice report={THREE_ISSUES} defaultOpen />);
    // 不浮在预览上：没有绝对 / 固定定位与层级
    expect(html).not.toContain("absolute");
    expect(html).not.toContain("fixed");
    expect(html).not.toContain("z-");
    expect(html).not.toContain("pointer-events-none");
    // 不自己变成对话框 / 遮罩，抽屉开合与焦点管理不受影响
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("<iframe");
    // 作为预览列的一个普通子元素出现（占位但不重叠）
    expect(html).toContain("shrink-0");
    // 按钮不是提交按钮
    expect(html).toContain('type="button"');
  });

  it("措辞不做过度承诺", () => {
    const html = renderToStaticMarkup(<ProjectCompatNotice report={THREE_ISSUES} defaultOpen />);
    expect(html).not.toContain("完全支持");
    expect(html).not.toContain("已完整导入");
    expect(html).not.toContain("完全兼容");
    expect(html).not.toContain("没有问题");
  });

  it("真分析器产出的报告也能直接渲染（文案与报告一致）", () => {
    const report = analyzeProjectCompat({
      html: `<html><head><script src="js/app.js" defer></script></head><body><img src="img/gone.png"></body></html>`,
      htmlPath: "demo/index.html",
      files: ["index.html", "js/app.js"],
      readText: () => "init();\n",
      mapPath: (rel) => `demo/${rel}`,
    });
    expect(report.total).toBe(2);
    const html = renderToStaticMarkup(<ProjectCompatNotice report={report} defaultOpen />);
    expect(html).toContain("会被去掉");
    expect(html).toContain("img/gone.png");
    expect(html).toContain("2 类 2 处");
  });
});
