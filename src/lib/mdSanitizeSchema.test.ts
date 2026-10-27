import { describe, expect, it } from "vitest";
import { mdSanitizeSchema, sanitizeAllowsTag } from "./mdSanitizeSchema";

describe("mdSanitizeSchema", () => {
  it("allows gfm / katex / media tags", () => {
    for (const t of ["table", "thead", "code", "span", "div", "img", "video", "math", "mi"]) {
      expect(sanitizeAllowsTag(t)).toBe(true);
    }
  });

  it("does not allow script", () => {
    expect(sanitizeAllowsTag("script")).toBe(false);
  });

  it("exports attributes for code className", () => {
    const code = mdSanitizeSchema.attributes?.code || [];
    expect(code.some((a) => Array.isArray(a) && a[0] === "className")).toBe(true);
  });
});
