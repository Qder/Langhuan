import { describe, expect, it } from "vitest";
import {
  guessCursorInSlice,
  isMonoSrcSlice,
  prepareAppendAtEnd,
  replaceRange,
  trailingNewline,
} from "./mdInlineEdit";

describe("trailingNewline", () => {
  it("detects \\n and \\r\\n", () => {
    expect(trailingNewline("a\n")).toBe("\n");
    expect(trailingNewline("a\r\n")).toBe("\r\n");
    expect(trailingNewline("a")).toBe("");
  });
});

describe("replaceRange", () => {
  it("replaces a middle paragraph without touching neighbors", () => {
    const src = "# Title\n\nhello world\n\n## Next\n";
    const start = src.indexOf("hello");
    const end = start + "hello world".length;
    const next = replaceRange(src, start, end, "hola mundo");
    expect(next).toBe("# Title\n\nhola mundo\n\n## Next\n");
    expect(next.slice(0, start)).toBe(src.slice(0, start));
    expect(next.slice(start + "hola mundo".length)).toBe(src.slice(end));
  });

  it("preserves front matter byte-for-byte when editing body", () => {
    const fm = "---\ntitle: Demo\ntags: [a]\n---\n\n";
    const body = "para one\n\npara two\n";
    const src = fm + body;
    const start = fm.length;
    const end = start + "para one".length;
    const next = replaceRange(src, start, end, "PARA ONE");
    expect(next.startsWith(fm)).toBe(true);
    expect(next.slice(fm.length)).toBe("PARA ONE\n\npara two\n");
  });

  it("keeps fenced code fences when replacing inner range that includes them", () => {
    const src = "before\n\n```js\nconsole.log(1)\n```\n\nafter\n";
    const start = src.indexOf("```js");
    const end = src.indexOf("after") - 2; // through closing fence + newline before blank
    const fence = src.slice(start, end);
    expect(fence.startsWith("```js")).toBe(true);
    expect(fence.includes("```")).toBe(true);
    const next = replaceRange(
      src,
      start,
      end,
      "```js\nconsole.log(2)\n```\n"
    );
    expect(next).toContain("```js\nconsole.log(2)\n```");
    expect(next.startsWith("before\n\n")).toBe(true);
    expect(next.endsWith("\nafter\n")).toBe(true);
  });

  it("preserves trailing newline so the next heading is not glued", () => {
    const src = "para\n# Heading\n";
    // slice "para\n" — if we replace with "para" without nl, heading would glue
    const next = replaceRange(src, 0, 5, "para");
    expect(next).toBe("para\n# Heading\n");
  });

  it("inserts a separating newline when after is a bare heading with no leading nl", () => {
    const src = "para# Heading\n"; // pathological but covered by rule
    const next = replaceRange(src, 0, 4, "para");
    expect(next.startsWith("para\n#")).toBe(true);
  });

  it("handles empty replacement", () => {
    const src = "a\n\nb\n";
    const next = replaceRange(src, 0, 1, "");
    expect(next).toBe("\n\nb\n");
  });

  it("handles edit at end of file", () => {
    const src = "hello";
    const next = replaceRange(src, 0, 5, "hello!");
    expect(next).toBe("hello!");
  });

  it("handles insert at end (start === end)", () => {
    const src = "hello";
    const next = replaceRange(src, 5, 5, "\n\nworld");
    expect(next).toBe("hello\n\nworld");
  });

  it("preserves CRLF trailing newline style", () => {
    const src = "para\r\n# H\r\n";
    const next = replaceRange(src, 0, 6, "PARA"); // original slice "para\r\n"
    expect(next).toBe("PARA\r\n# H\r\n");
  });

  it("clamps out-of-range indices", () => {
    const src = "abc";
    expect(replaceRange(src, -10, 100, "z")).toBe("z");
    expect(replaceRange(src, 2, 1, "z")).toBe("abzc");
  });

  it("does not alter characters outside [start,end) even with unicode / emoji", () => {
    const src = "前缀 🎉\n\n中间段落\n\n后缀";
    const start = src.indexOf("中间");
    const end = start + "中间段落".length;
    const next = replaceRange(src, start, end, "替换✅");
    expect(next.slice(0, start)).toBe(src.slice(0, start));
    expect(next.slice(start, start + "替换✅".length)).toBe("替换✅");
    expect(next.slice(start + "替换✅".length)).toBe(src.slice(end));
  });
});

describe("prepareAppendAtEnd", () => {
  it("empty source stays empty range at 0", () => {
    expect(prepareAppendAtEnd("")).toEqual({
      prepared: "",
      start: 0,
      end: 0,
    });
  });

  it("adds blank line separator when missing", () => {
    const r = prepareAppendAtEnd("hello");
    expect(r.prepared).toBe("hello\n\n");
    expect(r.start).toBe(r.prepared.length);
    expect(r.end).toBe(r.start);
  });

  it("does not duplicate when already ends with blank line", () => {
    const r = prepareAppendAtEnd("hello\n\n");
    expect(r.prepared).toBe("hello\n\n");
    expect(r.start).toBe(7);
  });
});

describe("isMonoSrcSlice", () => {
  it("detects fences and math", () => {
    expect(isMonoSrcSlice("```js\nX\n```")).toBe(true);
    expect(isMonoSrcSlice("$$\\alpha$$")).toBe(true);
    expect(isMonoSrcSlice("plain para")).toBe(false);
  });
});

describe("guessCursorInSlice", () => {
  it("uses approxOffset when provided", () => {
    expect(guessCursorInSlice("abcdef", { approxOffset: 3 })).toBe(3);
  });

  it("finds clickText", () => {
    expect(guessCursorInSlice("hello world", { clickText: "world" })).toBe(6);
  });

  it("falls back to 0", () => {
    expect(guessCursorInSlice("hello", { clickText: "zzz" })).toBe(0);
  });
});
