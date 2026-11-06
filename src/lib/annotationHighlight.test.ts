// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pickQuoteSegments } from "./annotationHighlight";

/**
 * 构造一小段「预览正文」：块上带 data-src-start/end，模拟 rehypeSrcPositions
 * 之后真实 DOM 的形状。
 */
function root(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/** 把返回的段拼回字符串，方便断言。 */
function joined(segs: { node: Text; start: number; end: number }[] | null) {
  if (!segs) return null;
  return segs.map((s) => (s.node.nodeValue || "").slice(s.start, s.end)).join("");
}

/** 段所在的块（用 data-src-start 认）。 */
function blockOf(segs: { node: Text }[] | null) {
  return segs?.map((s) => s.node.parentElement?.closest("[data-src-start]")?.getAttribute("data-src-start")) ?? null;
}

describe("pickQuoteSegments", () => {
  it("单次出现 → 直接命中", () => {
    const el = root(
      `<p data-src-start="0" data-src-end="20">第一段目标句在这里。</p>
       <p data-src-start="21" data-src-end="40">第二段别的内容。</p>`,
    );
    expect(joined(pickQuoteSegments(el, "目标句在这里", 2))).toBe("目标句在这里");
  });

  it("重复出现时按 reanchor 偏移挑最近的那一次（旧实现会错取第一处）", () => {
    const el = root(
      `<p data-src-start="0" data-src-end="30">前 重复句 中</p>
       <p data-src-start="31" data-src-end="60">后 重复句 尾</p>`,
    );
    expect(blockOf(pickQuoteSegments(el, "重复句", 33))).toEqual(["31"]);
    expect(blockOf(pickQuoteSegments(el, "重复句", 2))).toEqual(["0"]);
  });

  it("原文已变（quote 不在任何地方）→ null，不猜", () => {
    const el = root(`<p data-src-start="0" data-src-end="10">完全不同的话。</p>`);
    expect(pickQuoteSegments(el, "目标句在这里", 2)).toBeNull();
  });

  it("跨文本节点（选区跨过加粗）切成多段，而不是放弃", () => {
    const el = root(
      `<p data-src-start="0" data-src-end="40">前面 <strong>强调</strong>后面</p>`,
    );
    // 用户拖选「面 强调后」时，纯文本是连续的，但 DOM 里横跨三个文本节点。
    const segs = pickQuoteSegments(el, "面 强调后", 0);
    expect(joined(segs)).toBe("面 强调后");
    expect(segs!.length).toBe(3);
  });

  it("不把代码行号槽 / 复制按钮的文本当正文", () => {
    const el = root(
      `<div data-src-start="0" data-src-end="50">
         <div class="lh-code-gutter"><div class="lh-code-gutter-line">1</div></div>
         <button class="lh-codeblock-copy">复制</button>
         <div><span>目标文本</span></div>
       </div>`,
    );
    expect(pickQuoteSegments(el, "复制", 0)).toBeNull();
    expect(joined(pickQuoteSegments(el, "目标文本", 0))).toBe("目标文本");
  });

  it("空 quote → null", () => {
    const el = root(`<p data-src-start="0" data-src-end="5">内容</p>`);
    expect(pickQuoteSegments(el, "   ", 0)).toBeNull();
  });

  it("没有 data-src 时退回全文唯一匹配", () => {
    const el = root(`<p>唯一目标</p><p>其它</p>`);
    expect(joined(pickQuoteSegments(el, "唯一目标", 0))).toBe("唯一目标");
  });

  it("没有 data-src 且全文重复 → null", () => {
    const el = root(`<p>重复句</p><p>重复句</p>`);
    expect(pickQuoteSegments(el, "重复句", 0)).toBeNull();
  });
});
