import { describe, expect, it } from "vitest";
import {
  annotationsForDoc,
  createAnnotation,
  rematchAnnotation,
  updateAnnotationNote,
} from "./annotations";

describe("annotations model", () => {
  it("creates and filters by doc", () => {
    const a = createAnnotation({
      docId: "d1",
      quote: "hello",
      start: 0,
      end: 5,
      note: "  note  ",
    });
    expect(a.note).toBe("note");
    expect(a.color).toBe("cinnabar");
    expect(annotationsForDoc([a], "d1")).toHaveLength(1);
    expect(annotationsForDoc([a], "d2")).toHaveLength(0);
  });

  it("updates note", () => {
    const a = createAnnotation({ docId: "d", quote: "x", start: 0, end: 1 });
    const b = updateAnnotationNote(a, "新批注");
    expect(b.note).toBe("新批注");
    expect(b.id).toBe(a.id);
  });

  it("rematches when body shifts", () => {
    const a = createAnnotation({
      docId: "d",
      quote: "目标句",
      start: 0,
      end: 3,
    });
    const source = "前缀\n目标句\n后缀";
    const m = rematchAnnotation(source, a);
    expect(m.precision).toBe("search");
    expect(source.slice(m.start, m.end)).toBe("目标句");
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
