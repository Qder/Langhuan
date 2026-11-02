import { describe, expect, it } from "vitest";
import {
  annotationsForDoc,
  createAnnotation,
  rematchAnnotation,
  resolveAnnotation,
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
