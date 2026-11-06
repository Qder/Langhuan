import { describe, expect, it } from "vitest";
import {
  annotationLostHint,
  annotationsForDoc,
  createAnnotation,
  formatReanchorStatus,
  headingAtOffset,
  headingStillPresent,
  normalizeAnnotation,
  rematchAnnotation,
  rematchAnnotationWithAnchor,
  resolveAnnotation,
  summarizeReanchor,
  updateAnnotationNote,
} from "./annotations";

describe("annotations model", () => {
  it("creates and filters by doc", () => {
    const a = createAnnotation({
      docId: "d1",
      path: "d1.md",
      quote: "hello",
      start: 0,
      end: 5,
      note: "  note  ",
      source: "hello world",
    });
    expect(a.note).toBe("note");
    expect(a.color).toBe("cinnabar");
    expect(a.path).toBe("d1.md");
    expect(a.contextAfter.startsWith(" ")).toBe(true);
    expect(annotationsForDoc([a], "d1")).toHaveLength(1);
    expect(annotationsForDoc([a], "d2")).toHaveLength(0);
  });

  it("updates note", () => {
    const a = createAnnotation({ docId: "d", quote: "x", start: 0, end: 1 });
    const b = updateAnnotationNote(a, "新批注");
    expect(b.note).toBe("新批注");
    expect(b.id).toBe(a.id);
  });

  it("reanchors after inserting a line at paragraph start", () => {
    const body0 = "第一段目标句在这里。\n第二段。";
    const start = body0.indexOf("目标句在这里");
    const end = start + "目标句在这里".length;
    const a = createAnnotation({
      docId: "d",
      path: "n.md",
      quote: "目标句在这里",
      start,
      end,
      source: body0,
    });
    const body1 = "插入的新行\n" + body0;
    const m = rematchAnnotation(body1, a);
    expect(m.precision).toBe("reanchor");
    expect(body1.slice(m.start, m.end)).toBe("目标句在这里");
    const resolved = resolveAnnotation(body1, a);
    expect(resolved.status).toBe("active");
    expect(resolved.start).toBe(m.start);
  });

  it("marks stale instead of attaching to a wrong duplicate quote", () => {
    const body0 = "开头\n唯一目标\n结尾";
    const start = body0.indexOf("唯一目标");
    const a = createAnnotation({
      docId: "d",
      quote: "唯一目标",
      start,
      end: start + 4,
      source: body0,
    });
    // Quote removed; a different later sentence should NOT be matched via global search
    const body1 = "开头\n别的内容\n结尾";
    const m = rematchAnnotation(body1, a);
    expect(m.precision).toBe("lost");
    expect(resolveAnnotation(body1, a).status).toBe("stale");
  });

  it("does not pick the wrong of two identical quotes without context win", () => {
    const quote = "重复句";
    const body = `前 ${quote} 中\n后 ${quote} 尾`;
    const first = body.indexOf(quote);
    const a = createAnnotation({
      docId: "d",
      quote,
      start: first,
      end: first + quote.length,
      source: body,
      // wipe context to force ambiguity path after shift destroys exact
    });
    // Force non-exact by shifting offsets into whitespace
    const broken = { ...a, start: 0, end: quote.length, plainOffset: 0, contextBefore: "", contextAfter: "" };
    const m = rematchAnnotation(body, broken);
    // two hits, no context → lost (never wrong sentence)
    expect(m.precision).toBe("lost");
  });

  it("marks lost when quote gone", () => {
    const a = createAnnotation({
      docId: "d",
      quote: "不存在",
      start: 0,
      end: 3,
    });
    expect(rematchAnnotation("全是别的", a).precision).toBe("lost");
  });
});


describe("reanchor summary", () => {
  it("counts insert-line reanchor and delete-sentence lost", () => {
    const body0 = "第一段目标句在这里。\n第二段保留句。";
    const q1 = "目标句在这里";
    const q2 = "第二段保留句";
    const a1 = createAnnotation({
      docId: "d",
      quote: q1,
      start: body0.indexOf(q1),
      end: body0.indexOf(q1) + q1.length,
      source: body0,
    });
    const a2 = createAnnotation({
      docId: "d",
      quote: q2,
      start: body0.indexOf(q2),
      end: body0.indexOf(q2) + q2.length,
      source: body0,
    });
    const body1 = "插入的新行\n第一段目标句在这里。\n已被删掉的位置";
    const r1 = rematchAnnotation(body1, a1);
    const r2 = rematchAnnotation(body1, a2);
    expect(r1.precision).toBe("reanchor");
    expect(r2.precision).toBe("lost");
    const summary = summarizeReanchor([r1, r2]);
    expect(summary).toEqual({ exact: 0, reanchor: 1, lost: 1 });
    // 文案必须点明「原文已变」，只报数字不够。
    const msg = formatReanchorStatus(summary)!;
    expect(msg).toContain("原文已变");
    expect(msg).toContain("1 条已重新对齐");
    expect(msg).toContain("1 条定位不准");
    expect(
      formatReanchorStatus({ exact: 2, reanchor: 0, lost: 0 }),
    ).toBeNull();
  });

  it("全部失效 / 全部重锚各有独立说法", () => {
    expect(formatReanchorStatus({ exact: 0, reanchor: 0, lost: 3 })).toBe(
      "原文已变，3 条批注定位不准（只在侧栏保留）",
    );
    expect(formatReanchorStatus({ exact: 1, reanchor: 2, lost: 0 })).toBe(
      "原文有改动，2 条批注已重新对齐",
    );
  });
});

describe("heading anchor", () => {
  const body = ["# 总览", "", "开头一句。", "", "## 第二节", "", "目标句子在这里。", ""].join(
    "\n",
  );

  function annWithHeading() {
    const start = body.indexOf("目标句子在这里");
    return createAnnotation({
      docId: "d",
      quote: "目标句子在这里",
      start,
      end: start + "目标句子在这里".length,
      source: body,
      heading: headingAtOffset(body, start),
    });
  }

  it("记下的是所在小节标题，不是文档第一个标题", () => {
    const a = annWithHeading();
    expect(a.heading).toBe("第二节");
  });

  it("偏移在标题行之前时退回上一个标题", () => {
    expect(headingAtOffset(body, body.indexOf("开头一句"))).toBe("总览");
    expect(headingAtOffset("没有标题的正文", 3)).toBe("");
  });

  it("标题还在就照常重锚", () => {
    const a = annWithHeading();
    const edited = body.replace("目标句子在这里。", "目标句子在这里，改了一个字。");
    const m = rematchAnnotationWithAnchor(edited, a);
    expect(m.precision).not.toBe("lost");
    expect(edited.slice(m.start, m.start + 2)).toBe("目标");
    expect(resolveAnnotation(edited, a).status).toBe("active");
  });

  it("小节被整段删掉 → 失效，并说明是小节没了", () => {
    const a = annWithHeading();
    const edited = body.replace("## 第二节", "## 换了个小节").replace("目标句子在这里。", "别的内容。");
    expect(headingStillPresent(edited, a)).toBe(false);
    const m = rematchAnnotationWithAnchor(edited, a);
    expect(m.precision).toBe("lost");
    expect(m.lostReason).toBe("heading-gone");
    expect(annotationLostHint(m.lostReason)).toContain("小节");
  });

  it("旧数据没有 heading 字段 → 不因锚失效，行为与以前一致", () => {
    const a = annWithHeading();
    const legacy = normalizeAnnotation({ ...a, heading: undefined });
    expect(legacy.heading).toBeUndefined();
    const edited = body.replace("## 第二节", "## 换了个小节");
    expect(headingStillPresent(edited, legacy)).toBe(true);
    expect(rematchAnnotationWithAnchor(edited, legacy).precision).not.toBe("lost");
  });

  it("段落被挪到别的小节不算失效", () => {
    const a = annWithHeading();
    const moved = [
      "# 总览",
      "",
      "## 第二节",
      "",
      "这一节还在但正文换了。",
      "",
      "## 附录",
      "",
      "目标句子在这里。",
      "",
    ].join("\n");
    expect(headingStillPresent(moved, a)).toBe(true);
    expect(rematchAnnotationWithAnchor(moved, a).precision).not.toBe("lost");
  });
});

describe("lost reasons", () => {
  it("文字被删干净 → quote-gone", () => {
    const a = createAnnotation({ docId: "d", quote: "目标", start: 0, end: 2 });
    const m = rematchAnnotationWithAnchor("完全无关的内容", a);
    expect(m.precision).toBe("lost");
    expect(m.lostReason).toBe("quote-gone");
    expect(annotationLostHint(m.lostReason)).toContain("找不到");
  });

  it("同文多次且分不清 → ambiguous", () => {
    const quote = "重复句";
    const body = `前 ${quote} 中\n后 ${quote} 尾`;
    const first = body.indexOf(quote);
    const a = createAnnotation({
      docId: "d",
      quote,
      start: first,
      end: first + quote.length,
      source: body,
    });
    const broken = {
      ...a,
      start: 0,
      end: quote.length,
      plainOffset: 0,
      contextBefore: "",
      contextAfter: "",
    };
    const m = rematchAnnotationWithAnchor(body, broken);
    expect(m.lostReason).toBe("ambiguous");
    expect(annotationLostHint(m.lostReason)).toContain("多处相同文字");
  });
});
