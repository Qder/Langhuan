/**
 * 插图块在「可视化编辑」里的往返。
 *
 * 预览把「一整段一张图」渲染成 <figure><img><figcaption>，编辑器克隆的就是这个 figure。
 * 序列化必须：图从源码原样搬回（src 在预览里可能已被改写成资源 URL），
 * 图注（alt 的呈现）绝不写回正文 —— 否则点一下图、点走，图就变成一行字了。
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { serializeVisualBlock, serializeVisualDomHalf } from "./mdVisualSerialize";

const SLICE = "![藏书阁 平面图](assets/plan.png)\n";

function dom(body: string) {
  return new JSDOM(`<body>${body}</body>`).window.document;
}

function serialize(el: Element, slice = SLICE) {
  return serializeVisualBlock({ originalSlice: slice, blockType: "paragraph", element: el });
}

describe("figure + figcaption（预览现在的形状）", () => {
  it("图原样回到源码，图注不写进正文", () => {
    const doc = dom(
      `<figure><img alt="藏书阁 平面图" src="blob:http://localhost/abc"><figcaption>藏书阁 平面图</figcaption></figure>`
    );
    const figure = doc.querySelector("figure")!;
    expect(serialize(figure)).toBe("![藏书阁 平面图](assets/plan.png)\n");
    expect(serializeVisualDomHalf("paragraph", figure, SLICE)).toBe(
      "![藏书阁 平面图](assets/plan.png)\n"
    );
  });

  it("没有 alt 的图（不生成图注）也照样回得来", () => {
    const doc = dom(`<p><img src="blob:x"></p>`);
    const p = doc.querySelector("p")!;
    expect(serialize(p, "![](a.png)\n")).toBe("![](a.png)\n");
  });
});

describe("行内混排", () => {
  it("文字 + 图：两边文字都在，图在原来的位置", () => {
    const doc = dom(
      `<p>前面的话 <img alt="图" src="blob:x"> 后面的话</p>`
    );
    const p = doc.querySelector("p")!;
    expect(serialize(p, "前面的话 ![图](a.png) 后面的话\n")).toBe(
      "前面的话 ![图](a.png) 后面的话\n"
    );
  });

  it("两张图按出现顺序对上（不会串位）", () => {
    const doc = dom(`<p><img alt="甲" src="blob:1"> <img alt="乙" src="blob:2"></p>`);
    const p = doc.querySelector("p")!;
    expect(serialize(p, "![甲](a.png) ![乙](b.png)\n")).toBe("![甲](a.png) ![乙](b.png)\n");
  });
});

describe("兜底", () => {
  it("源码里没有对应的图（刚粘进来的）→ 宁可少写也不编假路径", () => {
    const doc = dom(`<p>文字 <img alt="新图" src="data:image/png;base64,xx"></p>`);
    const p = doc.querySelector("p")!;
    // 图去掉，文字留着；前面那个空格来自 DOM 文本节点，原样保留
    expect(serialize(p, "文字\n")).toBe("文字 \n");
  });

  it("图和 wikilink 各用各的（上下文不互相吃）", () => {
    const doc = dom(`<p><img alt="图" src="blob:x"> 见 <button class="wiki-link">某篇</button></p>`);
    const p = doc.querySelector("p")!;
    expect(serialize(p, "![图](a.png) 见 [[某篇]]\n")).toBe("![图](a.png) 见 [[某篇]]\n");
  });

  it("纯文字段落不受影响", () => {
    const doc = dom(`<p>就一句话</p>`);
    expect(serialize(doc.querySelector("p")!, "就一句话\n")).toBe("就一句话\n");
  });
});
