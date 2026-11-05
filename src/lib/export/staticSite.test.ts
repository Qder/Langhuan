import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildStaticSiteZip, htmlOutPath, SITE_ROOT } from "./staticSite";
import type { Document } from "../types";

const doc = (over: Partial<Document>): Document => ({
  id: "x",
  path: "a.md",
  type: "md",
  content: "",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const welcome = doc({
  id: "a",
  path: "欢迎.md",
  content: "# Hi\n\nhello\n\n![印](笔记/assets/seal.svg)\n\n见 [[功能验收]]。\n",
});

const acceptance = doc({
  id: "b",
  path: "笔记/功能验收.md",
  content: "# 功能验收\n\n> [!tip] 记住\n> 卡片\n\n回到 [[欢迎]]。\n",
});

const page = doc({
  id: "c",
  path: "页面/demo.html",
  type: "html",
  content: "<!DOCTYPE html><html><body>X</body></html>",
});

async function unzip(blob: Blob) {
  return JSZip.loadAsync(blob);
}

describe("整库静态站点：结构", () => {
  it("index + 每篇页面都在同一个根目录下", async () => {
    const zip = await unzip(await buildStaticSiteZip({ documents: [welcome, acceptance, page] }));
    const names = Object.keys(zip.files);
    expect(names).toContain(`${SITE_ROOT}/index.html`);
    expect(names).toContain(`${SITE_ROOT}/欢迎.html`);
    expect(names).toContain(`${SITE_ROOT}/笔记/功能验收.html`);
    expect(names).toContain(`${SITE_ROOT}/页面/demo.html`);
  });

  it("htmlOutPath 保留扩展名，zip 里不编码中文", () => {
    expect(htmlOutPath(welcome)).toBe("欢迎.html");
    expect(htmlOutPath(page)).toBe("页面/demo.html");
  });
});

describe("整库静态站点：离线可读", () => {
  it("相对图片真的落进 assets/，页面用相对路径", async () => {
    const zip = await unzip(
      await buildStaticSiteZip({
        documents: [welcome],
        readAsset: async () => ({ mime: "image/svg+xml", base64: "PHN2Zy8+" }),
      })
    );
    const media = Object.keys(zip.files).filter((n) => n.includes("/assets/") && !n.endsWith("/"));
    expect(media).toHaveLength(1);
    const pageHtml = await zip.file(`${SITE_ROOT}/欢迎.html`)!.async("string");
    // 页面在根目录，资产在 assets/ → assets/xxx.svg（文件名保留中文，href 编码）
    expect(pageHtml).toMatch(/src="assets\/[^"]+\.svg"/);
  });

  it("同一张图被多篇引用只落一份", async () => {
    const second = doc({ id: "d", path: "另一篇.md", content: "![印](笔记/assets/seal.svg)" });
    let reads = 0;
    const zip = await unzip(
      await buildStaticSiteZip({
        documents: [welcome, second],
        readAsset: async () => {
          reads += 1;
          return { mime: "image/svg+xml", base64: "PHN2Zy8+" };
        },
      })
    );
    const media = Object.keys(zip.files).filter((n) => n.includes("/assets/") && !n.endsWith("/"));
    expect(media).toHaveLength(1);
    expect(reads).toBe(1);
  });

  it("双链在页面之间可点，且是相对路径", async () => {
    const zip = await unzip(await buildStaticSiteZip({ documents: [welcome, acceptance] }));
    const home = await zip.file(`${SITE_ROOT}/欢迎.html`)!.async("string");
    // 欢迎.html 在根目录，目标在 笔记/ 下
    expect(home).toMatch(/href="[^"]*%E5%8A%9F%E8%83%BD%E9%AA%8C%E6%94%B6\.html"/);
    expect(home).not.toContain("[[");
  });

  it("嵌套目录里的页面向外跳时用 ../", async () => {
    const zip = await unzip(await buildStaticSiteZip({ documents: [welcome, acceptance] }));
    const nested = await zip.file(`${SITE_ROOT}/笔记/功能验收.html`)!.async("string");
    expect(nested).toMatch(/href="\.\.\/%E6%AC%A2%E8%BF%8E\.html"/);
  });

  it("callout 在 zip 页面里是卡片，不是字面量", async () => {
    const zip = await unzip(await buildStaticSiteZip({ documents: [acceptance] }));
    const html = await zip.file(`${SITE_ROOT}/笔记/功能验收.html`)!.async("string");
    expect(html).toContain("callout-tip");
    expect(html).not.toContain("[!tip]");
  });

  it("读不到资源时是占位说明，不是碎图", async () => {
    const broken = doc({ id: "e", path: "坏图.md", content: "![x](assets/none.png)" });
    const zip = await unzip(
      await buildStaticSiteZip({ documents: [broken], readAsset: async () => null })
    );
    const html = await zip.file(`${SITE_ROOT}/坏图.html`)!.async("string");
    expect(html).toContain("export-missing-media");
    expect(html).not.toContain("<img");
  });

  it("没有 readAsset 时不假装有图", async () => {
    const zip = await unzip(await buildStaticSiteZip({ documents: [welcome] }));
    const html = await zip.file(`${SITE_ROOT}/欢迎.html`)!.async("string");
    expect(html).toContain("export-missing-media");
    expect(Object.keys(zip.files).some((n) => n.includes("/assets/") && !n.endsWith("/"))).toBe(false);
  });
});
