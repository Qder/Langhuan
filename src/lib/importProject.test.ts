import { describe, expect, it } from "vitest";
import {
  detectProjectEntry,
  isIgnoredProjectPath,
  planProjectImport,
  sanitizeProjectName,
  uniqueProjectRoot,
} from "./importProject";

const NOW = new Date("2026-01-02T03:04:05.000Z");

const ENTRY = `<!DOCTYPE html><html><head><link rel="stylesheet" href="css/style.css"></head><body><button id="go">点我</button><script src="js/app.js"></script></body></html>`;

function demoFiles() {
  return [
    { path: "index.html", text: ENTRY },
    { path: "css/style.css", text: "body{color:#333}" },
    { path: "js/app.js", text: "document.title='x';" },
  ];
}

describe("detectProjectEntry", () => {
  it("优先根目录 index.html", () => {
    expect(detectProjectEntry(["about.html", "index.html"])).toBe("index.html");
    expect(detectProjectEntry(["pages/index.html", "index.html"])).toBe("index.html");
  });

  it("没有 index 时只接受唯一的 .html", () => {
    expect(detectProjectEntry(["about.html", "css/a.css"])).toBe("about.html");
    expect(detectProjectEntry(["a.html", "b.html"])).toBeNull();
  });

  it("没有 HTML 时返回 null", () => {
    expect(detectProjectEntry(["css/a.css", "js/b.js"])).toBeNull();
  });

  it("忽略目录里的 HTML 不算入口", () => {
    expect(detectProjectEntry(["node_modules/x/a.html"])).toBeNull();
    expect(detectProjectEntry([".git/a.html"])).toBeNull();
  });
});

describe("isIgnoredProjectPath", () => {
  it("跳过 .DS_Store / node_modules / .git 等", () => {
    expect(isIgnoredProjectPath(".DS_Store")).toBe(true);
    expect(isIgnoredProjectPath("node_modules/a/index.js")).toBe(true);
    expect(isIgnoredProjectPath(".git/config")).toBe(true);
    expect(isIgnoredProjectPath("css/.DS_Store")).toBe(true);
    expect(isIgnoredProjectPath(".langhuan/project.json")).toBe(true);
    expect(isIgnoredProjectPath("css/style.css")).toBe(false);
  });
});

describe("sanitizeProjectName / uniqueProjectRoot", () => {
  it("去掉路径与非法字符", () => {
    expect(sanitizeProjectName("my site")).toBe("my site");
    expect(sanitizeProjectName("a/b/c")).toBe("c");
    expect(sanitizeProjectName("a:b?c")).toBe("a-b-c");
    expect(sanitizeProjectName("   ")).toBe("项目");
  });

  it("根目录撞车时加序号", () => {
    expect(uniqueProjectRoot("demo", [])).toBe("demo");
    expect(uniqueProjectRoot("demo", ["demo/index.html"])).toBe("demo-2");
    expect(uniqueProjectRoot("demo", ["demo-2/a.md"])).toBe("demo");
  });
});

describe("planProjectImport", () => {
  it("拆分文档 / 文本资源，并生成 project.json 形状", () => {
    const plan = planProjectImport({
      name: "demo",
      files: demoFiles(),
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.root).toBe("demo");
    expect(plan.meta.entry).toBe("index.html");
    expect(plan.meta.files).toEqual(["css/style.css", "index.html", "js/app.js"]);
    expect(plan.meta.importedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(plan.meta.external).toEqual([]);
    expect(plan.docs).toEqual([{ path: "demo/index.html", content: ENTRY }]);
    expect(plan.rawText.map((f) => f.path)).toEqual([
      "demo/css/style.css",
      "demo/js/app.js",
    ]);
    expect(plan.rawBinary).toEqual([]);
  });

  it("记录上下文里的外链", () => {
    const page = `<html><head><link rel="stylesheet" href="https://cdn.x.com/a.css"><link rel="stylesheet" href="css/style.css"></head><body></body></html>`;
    const plan = planProjectImport({
      name: "demo",
      files: [{ path: "index.html", text: page }, { path: "css/style.css", text: "" }],
      now: NOW,
    });
    expect(plan.ok && plan.meta.external).toEqual(["https://cdn.x.com/a.css"]);
  });

  it("多 HTML 且无 index 时判失败", () => {
    const plan = planProjectImport({
      name: "demo",
      files: [{ path: "a.html", text: "<p>a</p>" }, { path: "b.html", text: "<p>b</p>" }],
      now: NOW,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("多个 .html");
  });

  it("没有 HTML 时判失败", () => {
    const plan = planProjectImport({ name: "demo", files: [{ path: "a.css", text: "" }], now: NOW });
    expect(plan.ok).toBe(false);
  });

  it("跳过忽略文件并记录在 skipped", () => {
    const plan = planProjectImport({
      name: "demo",
      files: [
        ...demoFiles(),
        { path: ".DS_Store", text: "x" },
        { path: "node_modules/lib/a.js", text: "y" },
      ],
      now: NOW,
    });
    expect(plan.ok && plan.skipped).toEqual([".DS_Store", "node_modules/lib/a.js"]);
    expect(plan.ok && plan.meta.files).toEqual(["css/style.css", "index.html", "js/app.js"]);
  });

  it("图片走二进制分支，.txt 保持资源不变成文档", () => {
    const plan = planProjectImport({
      name: "demo",
      files: [
        ...demoFiles(),
        { path: "img/logo.png", base64: "aGVsbG8=" },
        { path: "README.txt", text: "说明" },
      ],
      now: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rawBinary).toEqual([{ path: "demo/img/logo.png", base64: "aGVsbG8=" }]);
    expect(plan.rawText.map((f) => f.path)).toContain("demo/README.txt");
    expect(plan.docs.map((d) => d.path)).toEqual(["demo/index.html"]);
  });

  it("子目录里的 HTML 也能当唯一入口", () => {
    const plan = planProjectImport({
      name: "demo",
      files: [{ path: "site/about.html", text: "<p>a</p>" }],
      now: NOW,
    });
    expect(plan.ok && plan.meta.entry).toBe("site/about.html");
  });
});
