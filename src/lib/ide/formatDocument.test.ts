import { describe, expect, it } from "vitest";
import {
  formatBraced,
  formatDocument,
  formatJson,
  formatMarkdown,
  isFormatDocumentHotkey,
} from "./formatDocument";

describe("formatDocument", () => {
  it("formats json with indent", () => {
    const r = formatDocument("a.json", '{"a":1,"b":[2]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
      expect(r.changed).toBe(true);
    }
  });

  it("rejects invalid json", () => {
    const r = formatDocument("a.json", "{not json");
    expect(r.ok).toBe(false);
  });

  it("formatJson empty-ish", () => {
    expect(formatJson("")).toBe("\n");
  });

  it("formats js braces", () => {
    const src = "function f(){\nreturn 1\n}";
    const out = formatBraced(src, 2);
    expect(out).toBe("function f(){\n  return 1\n}\n");
  });

  it("formats markdown trailing space and blank lines", () => {
    expect(formatMarkdown("hi  \n\n\n\nthere  ")).toBe("hi\n\nthere\n");
  });

  it("detects Shift+Alt+F", () => {
    expect(
      isFormatDocumentHotkey({
        key: "f",
        shiftKey: true,
        altKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(true);
    expect(
      isFormatDocumentHotkey({
        key: "f",
        shiftKey: true,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(false);
  });

  it("formatDocument returns unchanged when already clean", () => {
    const text = "const x = 1;\n";
    const r = formatDocument("a.ts", text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(false);
  });
});
